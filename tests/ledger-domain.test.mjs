import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLearnedCategory,
  buildBudgetRows,
  buildMonthlySeries,
  buildSpendingPlan,
  detectRecurringSeries,
  hydrateTransaction,
  inferCategory,
  matchTransfers,
  mergeTransactions,
} from "../ledger-domain.mjs";

test("inferCategory prefers saved rules and merchant rules", () => {
  assert.equal(
    inferCategory({
      merchant: "Spotify USA",
      amount: -12.99,
      rules: [{ pattern: "spotify", category: "Entertainment" }],
      merchantRules: {},
    }),
    "Entertainment",
  );

  assert.equal(
    inferCategory({
      merchant: "Trader Joe's #123",
      amount: -45,
      rules: [],
      merchantRules: { "trader joe's": "Dining" },
    }),
    "Dining",
  );
});

test("mergeTransactions filters likely duplicates while keeping sorted order", () => {
  const existing = [
    hydrateTransaction({
      id: "a",
      date: "2026-04-02",
      description: "Coffee Corner",
      merchant: "Coffee Corner",
      merchantKey: "coffee corner",
      institution: "Card",
      amount: -4.5,
      category: "Coffee",
    }),
  ];
  const imported = [
    hydrateTransaction({
      id: "b",
      date: "2026-04-03",
      description: "Groceries",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -25,
      category: "Groceries",
    }),
    hydrateTransaction({
      id: "c",
      date: "2026-04-02",
      description: "Coffee Corner",
      merchant: "Coffee Corner",
      merchantKey: "coffee corner",
      institution: "Card",
      amount: -4.5,
      category: "Coffee",
    }),
  ];

  const result = mergeTransactions(imported, existing);

  assert.equal(result.added, 1);
  assert.deepEqual(
    result.transactions.map((transaction) => transaction.id),
    ["b", "a"],
  );
});

test("matchTransfers pairs offsetting transfer-like transactions", () => {
  const transactions = [
    hydrateTransaction({
      id: "left",
      date: "2026-04-01",
      description: "Transfer to savings",
      merchant: "Transfer to savings",
      institution: "Checking",
      account: "1111",
      amount: -300,
      category: "Transfer",
    }),
    hydrateTransaction({
      id: "right",
      date: "2026-04-02",
      description: "Transfer from checking",
      merchant: "Transfer from checking",
      institution: "Savings",
      account: "2222",
      amount: 300,
      category: "Transfer",
    }),
  ];

  matchTransfers(transactions);

  assert.equal(transactions[0].transferMatchId, "right");
  assert.equal(transactions[1].transferMatchId, "left");
});

test("detectRecurringSeries and buildMonthlySeries summarize transaction history", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-02-01",
      description: "Spotify",
      merchant: "Spotify",
      merchantKey: "spotify",
      institution: "Card",
      amount: -12.99,
      category: "Subscriptions",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-03-01",
      description: "Spotify",
      merchant: "Spotify",
      merchantKey: "spotify",
      institution: "Card",
      amount: -12.99,
      category: "Subscriptions",
    }),
    hydrateTransaction({
      id: "3",
      date: "2026-03-03",
      description: "Payroll",
      merchant: "Payroll",
      merchantKey: "payroll",
      institution: "Checking",
      amount: 1200,
      category: "Income",
    }),
  ];

  const recurring = detectRecurringSeries(transactions);
  const monthly = buildMonthlySeries(transactions);

  assert.equal(recurring.get("spotify")?.count, 2);
  assert.deepEqual(monthly, [
    { month: "2026-02", spending: 12.99, income: 0 },
    { month: "2026-03", spending: 12.99, income: 1200 },
  ]);
});

test("applyLearnedCategory updates matching merchant transactions", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-04-01",
      description: "Blue Bottle Coffee",
      merchant: "Blue Bottle Coffee",
      merchantKey: "blue bottle coffee",
      institution: "Card",
      amount: -6.25,
      category: "Coffee",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-04-05",
      description: "Blue Bottle Coffee",
      merchant: "Blue Bottle Coffee",
      merchantKey: "blue bottle coffee",
      institution: "Card",
      amount: -5.75,
      category: "Coffee",
    }),
  ];

  const result = applyLearnedCategory(transactions[0], "Dining", {}, transactions);

  assert.equal(result.merchantRules["blue bottle coffee"], "Dining");
  assert.deepEqual(
    result.transactions.map((transaction) => transaction.category),
    ["Dining", "Dining"],
  );
});

test("buildBudgetRows includes spending from categories outside the default budget list", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-04-01",
      description: "Split order",
      merchant: "Target",
      merchantKey: "target",
      institution: "Card",
      amount: -30,
      category: "Other",
      splits: [
        { category: "Household", amount: -18 },
        { category: "Groceries", amount: -12 },
      ],
    }),
  ];

  const rows = buildBudgetRows({
    transactions,
    monthBudgets: { Groceries: 100 },
    budgetCategories: ["Groceries", "Dining"],
    isMoneyMovement: (transaction) => transaction.isTransfer,
    getCategoryBreakdown: (transaction) => (transaction.splits?.length ? transaction.splits : [{ category: transaction.category, amount: transaction.amount }]),
  });

  assert.deepEqual(
    rows.map((row) => row.category),
    ["Dining", "Groceries", "Household"],
  );
  assert.equal(rows.find((row) => row.category === "Household")?.spent, 18);
});

test("buildSpendingPlan reports overspending when expenses exceed income", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-04-01",
      description: "Rent",
      merchant: "Landlord",
      merchantKey: "landlord",
      institution: "Checking",
      amount: -1000,
      category: "Housing",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-04-02",
      description: "Shopping spree",
      merchant: "Store",
      merchantKey: "store",
      institution: "Card",
      amount: -400,
      category: "Shopping",
    }),
    hydrateTransaction({
      id: "3",
      date: "2026-04-03",
      description: "Payroll",
      merchant: "Payroll",
      merchantKey: "payroll",
      institution: "Checking",
      amount: 1000,
      category: "Income",
    }),
  ];

  const plan = buildSpendingPlan({
    transactions,
    isMoneyMovement: (transaction) => transaction.isTransfer,
    getCategoryBreakdown: (transaction) => (transaction.splits?.length ? transaction.splits : [{ category: transaction.category, amount: transaction.amount }]),
    needsCategories: new Set(["Housing"]),
    wantsCategories: new Set(["Shopping"]),
  });

  assert.equal(plan[2].label, "Overspending");
  assert.equal(plan[2].amount, 400);
});
