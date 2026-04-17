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
    note: transaction.note || "",
    tags: Array.isArray(transaction.tags) ? transaction.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    reviewed: Boolean(transaction.reviewed),
    splits: Array.isArray(transaction.splits) ? transaction.splits : [],
  };
  hydrated.searchText = buildSearchText(hydrated);
  return hydrated;
}

export function sanitizeLedgerBudgets(budgets) {
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    return {};
  }

  const nextBudgets = {};
  Object.entries(budgets).forEach(([month, categoryBudgets]) => {
    if (!categoryBudgets || typeof categoryBudgets !== "object" || Array.isArray(categoryBudgets)) {
      return;
    }

    const cleanedEntries = Object.entries(categoryBudgets).flatMap(([category, amount]) => {
      const numericAmount = Number.parseFloat(String(amount));
      if (!category || !Number.isFinite(numericAmount) || numericAmount <= 0) {
        return [];
      }
      return [[category, Number(numericAmount.toFixed(2))]];
    });

    if (cleanedEntries.length) {
      nextBudgets[month] = Object.fromEntries(cleanedEntries);
    }
  });

  return nextBudgets;
}

export function sanitizeGoals(goals) {
  if (!Array.isArray(goals)) {
    return [];
  }

  return goals.flatMap((goal) => {
    if (!goal || typeof goal !== "object" || Array.isArray(goal)) {
      return [];
    }

    const id = String(goal.id || "").trim();
    const name = String(goal.name || "").trim();
    const category = String(goal.category || "").trim();
    const targetMonth = String(goal.targetMonth || "").trim();
    const targetAmount = Number.parseFloat(String(goal.targetAmount));

    if (!id || !name || !category || !targetMonth || !Number.isFinite(targetAmount) || targetAmount <= 0) {
      return [];
    }

    return [{
      id,
      name,
      category,
      targetMonth,
      targetAmount: Number(targetAmount.toFixed(2)),
    }];
  });
}

function getPreviousMonth(month) {
  const [yearText, monthText] = String(month).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) {
    return "";
  }
  const date = new Date(year, monthIndex - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyMerchantSpend(transactions, isMoneyMovement) {
  const spendingByMonth = new Map();

  transactions
    .filter((transaction) => transaction.amount < 0 && !isMoneyMovement(transaction))
    .forEach((transaction) => {
      const month = transaction.date.slice(0, 7);
      const merchantLabel = transaction.merchant || transaction.rawMerchant || transaction.description;
      const monthMap = spendingByMonth.get(month) || new Map();
      const current = monthMap.get(merchantLabel) || { amount: 0, count: 0 };
      current.amount += Math.abs(transaction.amount);
      current.count += 1;
      monthMap.set(merchantLabel, current);
      spendingByMonth.set(month, monthMap);
    });

  return spendingByMonth;
}

export function buildLedgerPayload({
  transactions = [],
  importPresets = {},
  merchantRules = {},
  rules = [],
  budgets = {},
  goals = [],
  exportedAt = new Date().toISOString(),
  version = 1,
}) {
  return {
    exportedAt,
    version,
    transactions: transactions.map(hydrateTransaction),
    importPresets: importPresets && typeof importPresets === "object" && !Array.isArray(importPresets) ? importPresets : {},
    merchantRules: merchantRules && typeof merchantRules === "object" && !Array.isArray(merchantRules) ? merchantRules : {},
    rules: Array.isArray(rules) ? rules : [],
    budgets: sanitizeLedgerBudgets(budgets),
    goals: sanitizeGoals(goals),
  };
}

export function parseLedgerPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Ledger payload must be an object.");
  }

  if (!Array.isArray(payload.transactions)) {
    throw new Error("Ledger payload is missing transactions.");
  }

  return {
    transactions: payload.transactions.map(hydrateTransaction),
    importPresets: payload.importPresets && typeof payload.importPresets === "object" && !Array.isArray(payload.importPresets) ? payload.importPresets : {},
    merchantRules: payload.merchantRules && typeof payload.merchantRules === "object" && !Array.isArray(payload.merchantRules) ? payload.merchantRules : {},
    rules: Array.isArray(payload.rules) ? payload.rules : [],
    budgets: sanitizeLedgerBudgets(payload.budgets),
    goals: sanitizeGoals(payload.goals),
  };
}

export function buildSearchText(transaction) {
  return [
    transaction.description,
    transaction.merchant,
    transaction.rawMerchant,
    transaction.category,
    transaction.note,
    ...(transaction.tags || []),
    transaction.reviewed ? "reviewed" : "needs review",
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

function buildMonthlySpendingByCategory(transactions, isMoneyMovement, getCategoryBreakdown) {
  const spendingByMonth = new Map();

  transactions
    .filter((transaction) => transaction.amount < 0 && !isMoneyMovement(transaction))
    .forEach((transaction) => {
      const month = transaction.date.slice(0, 7);
      const monthMap = spendingByMonth.get(month) || new Map();
      getCategoryBreakdown(transaction).forEach((item) => {
        const amount = Math.abs(item.amount);
        monthMap.set(item.category, (monthMap.get(item.category) || 0) + amount);
      });
      spendingByMonth.set(month, monthMap);
    });

  return spendingByMonth;
}

export function buildBudgetRows({ month, transactions, budgetsByMonth = {}, budgetCategories = [], isMoneyMovement, getCategoryBreakdown }) {
  const monthBudgets = budgetsByMonth[month] || {};
  if (!transactions.length && !Object.keys(monthBudgets).length) {
    return [];
  }

  const spendingByMonth = buildMonthlySpendingByCategory(transactions, isMoneyMovement, getCategoryBreakdown);
  const months = [...new Set([month, ...Object.keys(budgetsByMonth), ...transactions.map((transaction) => transaction.date.slice(0, 7))])]
    .filter((value) => value <= month)
    .sort();
  const availableByCategory = new Map();
  let activeRows = [];

  months.forEach((monthKey) => {
    const monthAssignments = budgetsByMonth[monthKey] || {};
    const spendingByCategory = spendingByMonth.get(monthKey) || new Map();
    const categories = [
      ...new Set([
        ...budgetCategories,
        ...availableByCategory.keys(),
        ...Object.keys(monthAssignments),
        ...spendingByCategory.keys(),
      ]),
    ];

    const nextAvailableByCategory = new Map();
    const rows = categories
      .sort((left, right) => left.localeCompare(right))
      .map((category) => {
        const carryover = Number((availableByCategory.get(category) || 0).toFixed(2));
        const assigned = Number(Number(monthAssignments[category] || 0).toFixed(2));
        const spent = Number((spendingByCategory.get(category) || 0).toFixed(2));
        const funding = carryover + assigned;
        const available = Number((funding - spent).toFixed(2));
        const percentUsed = funding > 0 ? (spent / funding) * 100 : spent > 0 ? 100 : 0;
        nextAvailableByCategory.set(category, available);
        return {
          category,
          assigned,
          spent,
          activity: spent,
          carryover,
          funding,
          available,
          remaining: available,
          percentUsed,
        };
      });

    if (monthKey === month) {
      activeRows = rows;
    }
    availableByCategory.clear();
    nextAvailableByCategory.forEach((value, category) => {
      availableByCategory.set(category, value);
    });
  });

  return activeRows;
}

export function buildBudgetSummary({ month, transactions, budgetsByMonth = {}, budgetRows = [], isMoneyMovement }) {
  const assigned = budgetRows.reduce((sum, row) => sum + row.assigned, 0);
  const activity = budgetRows.reduce((sum, row) => sum + row.activity, 0);
  const available = budgetRows.reduce((sum, row) => sum + row.available, 0);
  const carried = budgetRows.reduce((sum, row) => sum + Math.max(row.carryover, 0), 0);
  const income = transactions
    .filter((transaction) => transaction.date.startsWith(month) && transaction.amount > 0 && !isMoneyMovement(transaction))
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const readyToAssign = Number((income - assigned).toFixed(2));
  const previousMonth = getPreviousMonth(month);
  const previousAssigned = previousMonth && budgetsByMonth[previousMonth] ? Object.values(budgetsByMonth[previousMonth]).reduce((sum, value) => sum + Number(value || 0), 0) : 0;

  return {
    assigned: Number(assigned.toFixed(2)),
    activity: Number(activity.toFixed(2)),
    available: Number(available.toFixed(2)),
    carried: Number(carried.toFixed(2)),
    income: Number(income.toFixed(2)),
    readyToAssign,
    previousAssigned: Number(previousAssigned.toFixed(2)),
  };
}

export function buildSpendingPlan({ transactions, isMoneyMovement, getCategoryBreakdown, needsCategories, wantsCategories }) {
  const expenses = transactions.filter((transaction) => transaction.amount < 0 && !isMoneyMovement(transaction));
  const income = transactions
    .filter((transaction) => transaction.amount > 0 && !isMoneyMovement(transaction))
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  let needs = 0;
  let wants = 0;
  let subscriptions = 0;

  expenses.forEach((transaction) => {
    getCategoryBreakdown(transaction).forEach((item) => {
      const amount = Math.abs(item.amount);
      if (item.category === "Subscriptions") {
        subscriptions += amount;
      }
      if (needsCategories.has(item.category)) {
        needs += amount;
      } else if (wantsCategories.has(item.category)) {
        wants += amount;
      } else {
        wants += amount;
      }
    });
  });

  const savings = income - needs - wants;
  const spending = needs + wants;
  if (!transactions.length) {
    return [];
  }

  return [
    { label: "Needs", amount: needs, detail: `${spending > 0 ? Math.round((needs / spending) * 100) : 0}% of spending` },
    { label: "Wants", amount: wants, detail: `${spending > 0 ? Math.round((wants / spending) * 100) : 0}% of spending` },
    { label: savings >= 0 ? "Potential savings" : "Overspending", amount: Math.abs(savings), detail: income > 0 ? `${Math.round((Math.abs(savings) / income) * 100)}% of income` : "No income in this view" },
    { label: "Subscriptions", amount: subscriptions, detail: "Recurring services in this filtered month" },
  ];
}

export function buildGoalRows({ goals = [], budgetRows = [], formatMonthLabel = (value) => value }) {
  const budgetByCategory = new Map(budgetRows.map((row) => [row.category, row]));

  return sanitizeGoals(goals)
    .map((goal) => {
      const linkedBudget = budgetByCategory.get(goal.category);
      const saved = linkedBudget ? Math.max(linkedBudget.available, 0) : 0;
      const remaining = Math.max(goal.targetAmount - saved, 0);
      const progress = goal.targetAmount > 0 ? Math.min((saved / goal.targetAmount) * 100, 100) : 0;
      return {
        ...goal,
        saved: Number(saved.toFixed(2)),
        remaining: Number(remaining.toFixed(2)),
        progress,
        targetLabel: formatMonthLabel(goal.targetMonth),
      };
    })
    .sort((left, right) => left.targetMonth.localeCompare(right.targetMonth) || left.name.localeCompare(right.name));
}

export function buildReviewSummary({ transactions = [], isMoneyMovement }) {
  const spendingTransactions = transactions.filter((transaction) => !isMoneyMovement(transaction));
  const pending = spendingTransactions.filter((transaction) => !transaction.reviewed);
  const reviewed = spendingTransactions.filter((transaction) => transaction.reviewed);
  const pendingOutflows = pending.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const pendingInflows = pending.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    totalCount: spendingTransactions.length,
    reviewedCount: reviewed.length,
    pendingCount: pending.length,
    pendingOutflows: Number(pendingOutflows.toFixed(2)),
    pendingInflows: Number(pendingInflows.toFixed(2)),
    reviewedRate: spendingTransactions.length ? (reviewed.length / spendingTransactions.length) * 100 : 0,
  };
}

export function buildMerchantInsights({ transactions = [], month, isMoneyMovement }) {
  if (!month) {
    return [];
  }

  const spendingByMonth = getMonthlyMerchantSpend(transactions, isMoneyMovement);
  const current = spendingByMonth.get(month) || new Map();
  const previous = spendingByMonth.get(getPreviousMonth(month)) || new Map();

  return [...current.entries()]
    .map(([merchant, stats]) => {
      const previousStats = previous.get(merchant) || { amount: 0, count: 0 };
      const changeAmount = stats.amount - previousStats.amount;
      const changePercent = previousStats.amount > 0 ? (changeAmount / previousStats.amount) * 100 : stats.amount > 0 ? 100 : 0;
      return {
        merchant,
        amount: Number(stats.amount.toFixed(2)),
        count: stats.count,
        previousAmount: Number(previousStats.amount.toFixed(2)),
        changeAmount: Number(changeAmount.toFixed(2)),
        changePercent,
      };
    })
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
}
