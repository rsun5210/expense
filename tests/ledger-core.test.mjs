import test from "node:test";
import assert from "node:assert/strict";

import {
  detectAmountMode,
  escapeCsvValue,
  normalizeDate,
  parseAmountDetails,
  parseCsv,
  parseSplitInput,
  resolveAmount,
} from "../ledger-core.mjs";

test("parseCsv handles quoted commas and trims cells", () => {
  const csv = 'Date,Description,Amount\n2026-04-01,"Coffee, Corner ", "4.50"\n';
  const parsed = parseCsv(csv);

  assert.deepEqual(parsed.headers, ["Date", "Description", "Amount"]);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    Date: "2026-04-01",
    Description: "Coffee, Corner",
    Amount: "4.50",
  });
});

test("parseAmountDetails and resolveAmount support CR/DR text", () => {
  assert.deepEqual(parseAmountDetails("52.10 DR"), {
    value: 52.1,
    direction: "debit",
  });
  assert.equal(
    resolveAmount(
      { Amount: "52.10 DR" },
      { amount: "Amount", amountMode: "credit-debit-text", type: "", debit: "", credit: "" },
    ),
    -52.1,
  );
});

test("detectAmountMode identifies expense-positive exports", () => {
  const rows = [
    { Amount: "25.00", Description: "Coffee Shop" },
    { Amount: "110.42", Description: "Groceries" },
    { Amount: "-25.00", Description: "Payment thank you" },
  ];

  assert.equal(detectAmountMode(rows, "Amount"), "expense-positive");
});

test("normalizeDate handles slash-delimited dates", () => {
  assert.equal(normalizeDate("4/7/2026"), "2026-04-07");
  assert.equal(normalizeDate("04-07-26"), "2026-04-07");
});

test("parseSplitInput validates totals against the transaction amount", () => {
  assert.deepEqual(parseSplitInput("Groceries:12.50, Household:7.50", -20), [
    { category: "Groceries", amount: -12.5 },
    { category: "Household", amount: -7.5 },
  ]);
  assert.equal(parseSplitInput("Groceries:12.50", -20), null);
});

test("escapeCsvValue quotes values that need escaping", () => {
  assert.equal(escapeCsvValue('Coffee, "Corner"'), '"Coffee, ""Corner"""');
  assert.equal(escapeCsvValue("Plain text"), "Plain text");
});
