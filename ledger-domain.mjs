import { buildMerchantKey, daysBetween, normalizeMerchantKey, normalizeMerchantLabel } from "./ledger-core.mjs";

export const categoryRules = [
  { match: /whole foods|trader joe|costco|safeway|ralphs|grocery/i, category: "Groceries" },
  { match: /coffee|starbucks|philz|blue bottle/i, category: "Coffee" },
  { match: /uber|lyft|shell|chevron|76 |7-eleven|fuel|gas/i, category: "Transportation" },
  { match: /netflix|spotify|openai|chatgpt|apple\.com\/bill|hulu|subscription/i, category: "Subscriptions" },
  { match: /payroll|salary|direct deposit|income/i, category: "Income" },
  { match: /rent|landlord|mortgage|bilt housing/i, category: "Housing" },
  { match: /restaurant|cafe|grill|doordash|ubereats|chipotle|spitz|pizza|fooda/i, category: "Dining" },
  { match: /transfer|payment thank you|autopay|statement credit|refund|reversal|bilt rewards/i, category: "Transfer" },
  { match: /insurance/i, category: "Insurance" },
  { match: /walgreens|cvs|hospital|medical|dental/i, category: "Health" },
  { match: /ticket|festival|music|crssd|movie/i, category: "Entertainment" },
  { match: /usps|post office/i, category: "Other" },
];

export function matchRuleCategory(merchant, rules = []) {
  const normalized = normalizeMerchantKey(merchant);
  const rule = rules.find((current) => normalized.includes(current.pattern));
  return rule ? rule.category : "";
}

export function inferCategory({ merchant, amount, rules = [], merchantRules = {}, categoryMatchers = categoryRules }) {
  const ruleCategory = matchRuleCategory(merchant, rules);
  if (ruleCategory) {
    return ruleCategory;
  }

  const learnedCategory = merchantRules[normalizeMerchantKey(merchant)];
  if (learnedCategory) {
    return learnedCategory;
  }
  if (isTransferLikeText(merchant)) {
    return "Transfer";
  }
  if (amount > 0) {
    const incomeMatch = categoryMatchers.find((rule) => rule.category === "Income" && rule.match.test(merchant));
    return incomeMatch ? "Income" : "Other";
  }
  const match = categoryMatchers.find((rule) => rule.match.test(merchant));
  return match ? match.category : "Other";
}

export function isTransferLikeText(value) {
  return /refund|reversal|statement credit|credit back|payment|autopay|transfer|venmo|zelle|bilt rewards|bilt housing/i.test(value);
}

export function buildTransactionId(date, description, amount, institution, account) {
  return [date, description.toLowerCase(), amount.toFixed(2), institution.toLowerCase(), String(account || "").toLowerCase()].join("::");
}

export function mergeTransactions(importedTransactions, existingTransactions) {
  const mergedTransactions = [...existingTransactions];
  const existingIds = new Set(mergedTransactions.map((transaction) => transaction.id));
  let added = 0;

  importedTransactions.forEach((transaction) => {
    if (!existingIds.has(transaction.id) && !isLikelyDuplicate(transaction, mergedTransactions)) {
      mergedTransactions.push(transaction);
      existingIds.add(transaction.id);
      added += 1;
    }
  });

  mergedTransactions.sort((left, right) => right.date.localeCompare(left.date));
  return { transactions: mergedTransactions, added };
}

export function hydrateTransaction(transaction) {
  const merchant = transaction.merchant || normalizeMerchantLabel(transaction.rawMerchant || transaction.description);
  const hydrated = {
    ...transaction,
    rawMerchant: transaction.rawMerchant || merchant || transaction.description,
    merchant,
    merchantKey: transaction.merchantKey || buildMerchantKey({ merchant, rawMerchant: transaction.rawMerchant || merchant, description: transaction.description }),
    account: transaction.account || "",
    institution: transaction.institution || "Imported Statement",
    transferMatchId: transaction.transferMatchId || "",
    isTransfer: Boolean(transaction.isTransfer),
    recurringKey: transaction.recurringKey || "",
    recurringLabel: transaction.recurringLabel || "",
    recurringCount: transaction.recurringCount || 0,
    recurringAverage: transaction.recurringAverage || 0,
    splits: Array.isArray(transaction.splits) ? transaction.splits : [],
  };
  hydrated.searchText = buildSearchText(hydrated);
  return hydrated;
}

export function buildSearchText(transaction) {
  return [
    transaction.description,
    transaction.merchant,
    transaction.rawMerchant,
    transaction.category,
    transaction.institution,
    transaction.account,
    transaction.recurringLabel,
    ...(transaction.splits || []).map((split) => split.category),
  ]
    .join(" ")
    .toLowerCase();
}

export function applyLearnedCategory(sourceTransaction, category, merchantRules, transactions) {
  const nextMerchantRules = { ...merchantRules };
  const merchantKey = sourceTransaction.merchantKey;

  if (!merchantKey) {
    return {
      merchantRules: nextMerchantRules,
      transactions: transactions.map((transaction) =>
        transaction.id === sourceTransaction.id ? { ...transaction, category } : transaction,
      ),
    };
  }

  nextMerchantRules[merchantKey] = category;
  return {
    merchantRules: nextMerchantRules,
    transactions: transactions.map((transaction) =>
      transaction.merchantKey === merchantKey ? { ...transaction, category } : transaction,
    ),
  };
}

export function recategorizeSplits(transaction, categorizeTransaction) {
  if (!transaction.splits?.length) {
    return transaction.splits || [];
  }

  return transaction.splits.map((split) => ({
    ...split,
    category: split.category || categorizeTransaction(transaction.merchant || transaction.description, split.amount),
  }));
}

export function matchTransfers(transactions) {
  transactions.forEach((transaction) => {
    transaction.transferMatchId = "";
    transaction.isTransfer =
      transaction.category === "Transfer" ||
      isTransferLikeText(transaction.description) ||
      isTransferLikeText(transaction.merchant);
  });

  const transfers = transactions
    .filter((transaction) => transaction.isTransfer)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const used = new Set();

  for (let index = 0; index < transfers.length; index += 1) {
    const current = transfers[index];
    if (used.has(current.id)) {
      continue;
    }

    for (let matchIndex = index + 1; matchIndex < transfers.length; matchIndex += 1) {
      const candidate = transfers[matchIndex];
      if (used.has(candidate.id)) {
        continue;
      }

      if (current.account && candidate.account && current.account === candidate.account) {
        continue;
      }

      if (Math.abs(current.amount + candidate.amount) > 0.01) {
        continue;
      }

      if (Math.abs(daysBetween(current.date, candidate.date)) > 4) {
        continue;
      }

      current.transferMatchId = candidate.id;
      candidate.transferMatchId = current.id;
      used.add(current.id);
      used.add(candidate.id);
      break;
    }
  }
}

export function detectRecurringSeries(transactions) {
  const groups = new Map();
  transactions
    .filter((transaction) => transaction.amount < 0 && !transaction.isTransfer)
    .forEach((transaction) => {
      if (!transaction.merchantKey) {
        return;
      }
      const current = groups.get(transaction.merchantKey) || [];
      current.push(transaction);
      groups.set(transaction.merchantKey, current);
    });

  const recurring = new Map();
  groups.forEach((items, key) => {
    const months = new Set(items.map((item) => item.date.slice(0, 7)));
    if (items.length < 2 || months.size < 2) {
      return;
    }

    const amounts = items.map((item) => Math.abs(item.amount));
    const averageAmount = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    const maxVariance = Math.max(...amounts.map((value) => Math.abs(value - averageAmount)));
    if (maxVariance > Math.max(averageAmount * 0.2, 8)) {
      return;
    }

    recurring.set(key, {
      key,
      label: items[0].merchant || items[0].description,
      count: items.length,
      monthCount: months.size,
      averageAmount,
      frequencyLabel: months.size >= 2 ? "Likely monthly" : "Repeats",
    });
  });

  return recurring;
}

export function buildMonthlySeries(transactions) {
  const grouped = new Map();
  transactions.forEach((transaction) => {
    const key = transaction.date.slice(0, 7);
    const existing = grouped.get(key) || { month: key, spending: 0, income: 0 };
    if (transaction.amount < 0 && !transaction.isTransfer) {
      existing.spending += Math.abs(transaction.amount);
    }
    if (transaction.amount > 0 && !transaction.isTransfer) {
      existing.income += transaction.amount;
    }
    grouped.set(key, existing);
  });
  return [...grouped.values()].sort((left, right) => left.month.localeCompare(right.month));
}

export function buildAccountStats(transactions) {
  const grouped = new Map();
  transactions.forEach((transaction) => {
    if (!transaction.account) {
      return;
    }
    const key = `${transaction.institution}::${transaction.account}`;
    const existing = grouped.get(key) || {
      label: transaction.account,
      institution: transaction.institution,
      spending: 0,
      count: 0,
    };
    if (transaction.amount < 0 && !transaction.isTransfer) {
      existing.spending += Math.abs(transaction.amount);
    }
    existing.count += 1;
    grouped.set(key, existing);
  });
  return [...grouped.values()].sort((left, right) => right.spending - left.spending);
}

export function isLikelyDuplicate(candidate, existingTransactions) {
  return existingTransactions.some((existing) => {
    if (candidate.id === existing.id) {
      return true;
    }
    if (Math.abs(candidate.amount - existing.amount) > 0.01) {
      return false;
    }
    if (candidate.account && existing.account && candidate.account !== existing.account) {
      return false;
    }
    if (Math.abs(daysBetween(candidate.date, existing.date)) > 2) {
      return false;
    }
    const sameMerchant = candidate.merchantKey && existing.merchantKey && candidate.merchantKey === existing.merchantKey;
    const sameDescription = normalizeMerchantKey(candidate.description) === normalizeMerchantKey(existing.description);
    return sameMerchant || sameDescription;
  });
}

export function getCategoryBreakdown(transaction) {
  if (transaction.splits?.length) {
    return transaction.splits;
  }
  return [{ category: transaction.category, amount: transaction.amount }];
}

export function clearTransactionSplits(transaction) {
  transaction.splits = [];
}
