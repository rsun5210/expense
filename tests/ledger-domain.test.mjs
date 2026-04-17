import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLearnedCategory,
  buildBudgetRows,
  buildBudgetSummary,
  buildGoalRows,
  buildLedgerPayload,
  buildMerchantInsights,
  buildMonthlySeries,
  buildReviewSummary,
  buildSpendingPlan,
  detectRecurringSeries,
  hydrateTransaction,
  inferCategory,
  matchTransfers,
  mergeTransactions,
  parseLedgerPayload,
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
  assert.equal(recurring.get("spotify")?.averageIntervalDays, 28);
  assert.equal(recurring.get("spotify")?.nextExpectedDate, "2026-03-29");
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
    month: "2026-04",
    transactions,
    budgetsByMonth: {
      "2026-04": { Groceries: 100 },
    },
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

test("buildBudgetRows carries available balances forward month to month", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-03-03",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -60,
      category: "Groceries",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-04-05",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -110,
      category: "Groceries",
    }),
  ];

  const rows = buildBudgetRows({
    month: "2026-04",
    transactions,
    budgetsByMonth: {
      "2026-03": { Groceries: 200 },
      "2026-04": { Groceries: 100 },
    },
    budgetCategories: ["Groceries"],
    isMoneyMovement: (transaction) => transaction.isTransfer,
    getCategoryBreakdown: (transaction) => (transaction.splits?.length ? transaction.splits : [{ category: transaction.category, amount: transaction.amount }]),
  });

  assert.deepEqual(rows, [
    {
      category: "Groceries",
      assigned: 100,
      previousAssigned: 200,
      targetAssigned: 200,
      underfunded: 100,
      spent: 110,
      activity: 110,
      carryover: 140,
      funding: 240,
      available: 130,
      remaining: 130,
      percentUsed: 45.83333333333333,
    },
  ]);
});

test("buildBudgetSummary reports ready to assign and carryover totals", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-04-01",
      description: "Payroll",
      merchant: "Payroll",
      merchantKey: "payroll",
      institution: "Checking",
      amount: 2500,
      category: "Income",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-03-05",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -50,
      category: "Groceries",
    }),
  ];

  const rows = buildBudgetRows({
    month: "2026-04",
    transactions,
    budgetsByMonth: {
      "2026-03": { Groceries: 150 },
      "2026-04": { Groceries: 300, Dining: 100 },
    },
    budgetCategories: ["Groceries", "Dining"],
    isMoneyMovement: (transaction) => transaction.isTransfer,
    getCategoryBreakdown: (transaction) => (transaction.splits?.length ? transaction.splits : [{ category: transaction.category, amount: transaction.amount }]),
  });

  const summary = buildBudgetSummary({
    month: "2026-04",
    transactions,
    budgetsByMonth: {
      "2026-03": { Groceries: 150 },
      "2026-04": { Groceries: 300, Dining: 100 },
    },
    budgetRows: rows,
    isMoneyMovement: (transaction) => transaction.isTransfer,
  });

  assert.deepEqual(summary, {
    assigned: 400,
    activity: 0,
    available: 500,
    carried: 100,
    income: 2500,
    readyToAssign: 2100,
    previousAssigned: 150,
  });
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

test("buildLedgerPayload keeps notes and sanitizes budget persistence data", () => {
  const payload = buildLedgerPayload({
    version: 2,
    exportedAt: "2026-04-15T20:00:00.000Z",
    transactions: [
      {
        id: "txn-1",
        date: "2026-04-02",
        description: "Trader Joe's",
        merchant: "Trader Joe's",
        merchantKey: "trader joe's",
        institution: "Card",
        amount: -42.18,
        category: "Groceries",
        note: "Meal prep week",
      },
    ],
    budgets: {
      "2026-04": {
        Groceries: "300",
        Dining: 0,
        Shopping: "invalid",
      },
      "2026-05": [],
    },
    goals: [
      { id: "goal-1", name: "Vacation", category: "Travel", targetAmount: "1200", targetMonth: "2026-08" },
      { id: "goal-2", name: "", category: "Travel", targetAmount: 300, targetMonth: "2026-09" },
    ],
  });

  assert.equal(payload.version, 2);
  assert.equal(payload.transactions[0].note, "Meal prep week");
  assert.deepEqual(payload.budgets, {
    "2026-04": {
      Groceries: 300,
    },
  });
  assert.deepEqual(payload.goals, [
    { id: "goal-1", name: "Vacation", category: "Travel", targetAmount: 1200, targetMonth: "2026-08" },
  ]);
});

test("parseLedgerPayload normalizes imported transactions, notes, and budgets", () => {
  const parsed = parseLedgerPayload({
    transactions: [
      {
        id: "txn-2",
        date: "2026-04-03",
        description: "Split order",
        rawMerchant: "Target Store",
        institution: "Card",
        amount: -30,
        category: "Other",
        note: "Cleaning supplies + snacks",
        splits: [
          { category: "Household", amount: -18 },
          { category: "Groceries", amount: -12 },
        ],
      },
    ],
    budgets: {
      "2026-04": {
        Household: "120.50",
        Groceries: 220,
        Empty: "",
      },
    },
    goals: [
      { id: "goal-1", name: "Emergency fund", category: "Groceries", targetAmount: "500", targetMonth: "2026-06" },
    ],
  });

  assert.equal(parsed.transactions[0].note, "Cleaning supplies + snacks");
  assert.match(parsed.transactions[0].searchText, /cleaning supplies \+ snacks/);
  assert.deepEqual(parsed.budgets, {
    "2026-04": {
      Household: 120.5,
      Groceries: 220,
    },
  });
  assert.deepEqual(parsed.goals, [
    { id: "goal-1", name: "Emergency fund", category: "Groceries", targetAmount: 500, targetMonth: "2026-06" },
  ]);
});

test("buildGoalRows uses available budget balances for progress", () => {
  const rows = buildGoalRows({
    goals: [{ id: "goal-1", name: "Vacation", category: "Travel", targetAmount: 1000, targetMonth: "2026-08" }],
    budgetRows: [{ category: "Travel", available: 250 }],
    formatMonthLabel: (value) => value,
  });

  assert.deepEqual(rows, [
    {
      id: "goal-1",
      name: "Vacation",
      category: "Travel",
      targetAmount: 1000,
      targetMonth: "2026-08",
      saved: 250,
      remaining: 750,
      progress: 25,
      targetLabel: "2026-08",
    },
  ]);
});

test("buildReviewSummary tracks pending review counts and dollars", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-04-01",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -45,
      category: "Groceries",
      reviewed: false,
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-04-02",
      description: "Payroll",
      merchant: "Payroll",
      merchantKey: "payroll",
      institution: "Checking",
      amount: 2000,
      category: "Income",
      reviewed: true,
    }),
    hydrateTransaction({
      id: "3",
      date: "2026-04-03",
      description: "Coffee",
      merchant: "Blue Bottle",
      merchantKey: "blue bottle",
      institution: "Card",
      amount: -6.5,
      category: "Coffee",
      reviewed: false,
    }),
  ];

  const summary = buildReviewSummary({
    transactions,
    isMoneyMovement: (transaction) => transaction.isTransfer,
  });

  assert.deepEqual(summary, {
    totalCount: 3,
    reviewedCount: 1,
    pendingCount: 2,
    pendingOutflows: 51.5,
    pendingInflows: 0,
    reviewedRate: 33.33333333333333,
  });
});

test("buildMerchantInsights compares this month against the prior month", () => {
  const transactions = [
    hydrateTransaction({
      id: "1",
      date: "2026-03-02",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -80,
      category: "Groceries",
    }),
    hydrateTransaction({
      id: "2",
      date: "2026-04-02",
      description: "Trader Joe's",
      merchant: "Trader Joe's",
      merchantKey: "trader joe's",
      institution: "Card",
      amount: -120,
      category: "Groceries",
    }),
    hydrateTransaction({
      id: "3",
      date: "2026-03-08",
      description: "City Rent",
      merchant: "City Rent",
      merchantKey: "city rent",
      institution: "Checking",
      amount: -900,
      category: "Housing",
    }),
    hydrateTransaction({
      id: "4",
      date: "2026-04-01",
      description: "City Rent",
      merchant: "City Rent",
      merchantKey: "city rent",
      institution: "Checking",
      amount: -300,
      category: "Housing",
    }),
    hydrateTransaction({
      id: "5",
      date: "2026-04-10",
      description: "Blue Bottle",
      merchant: "Blue Bottle",
      merchantKey: "blue bottle",
      institution: "Card",
      amount: -15,
      category: "Coffee",
    }),
  ];

  const insights = buildMerchantInsights({
    transactions,
    month: "2026-04",
    isMoneyMovement: (transaction) => transaction.isTransfer,
  });

  assert.deepEqual(insights, [
    {
      merchant: "City Rent",
      amount: 300,
      count: 1,
      previousAmount: 900,
      changeAmount: -600,
      changePercent: -66.66666666666666,
    },
    {
      merchant: "Trader Joe's",
      amount: 120,
      count: 1,
      previousAmount: 80,
      changeAmount: 40,
      changePercent: 50,
    },
    {
      merchant: "Blue Bottle",
      amount: 15,
      count: 1,
      previousAmount: 0,
      changeAmount: 15,
      changePercent: 100,
    },
  ]);
});

test("parseLedgerPayload rejects non-ledger payloads without transactions", () => {
  assert.throws(() => parseLedgerPayload({ budgets: {} }), /missing transactions/i);
});
