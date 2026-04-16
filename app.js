import {
  buildMerchantKey,
  cleanText,
  detectAmountMode,
  escapeCsvValue,
  isPlainObject,
  normalizeDate,
  normalizeMerchantLabel,
  parseCsv,
  parseSplitInput,
  resolveAmount,
} from "./ledger-core.mjs";
import {
  applyLearnedCategory as applyLearnedCategoryByMerchant,
  buildAccountStats,
  buildMonthlySeries,
  buildSearchText,
  buildTransactionId,
  categoryRules,
  clearTransactionSplits,
  detectRecurringSeries,
  getCategoryBreakdown,
  hydrateTransaction,
  inferCategory,
  matchTransfers,
  mergeTransactions as mergeImportedTransactions,
  recategorizeSplits,
} from "./ledger-domain.mjs";
import {
  createCurrencyFormatter,
  createDateFormatter,
  createMonthFormatter,
  buildFlagLabel,
  formatCurrency,
  formatDate,
  formatMonth,
  renderAccountsAndTransfers,
  renderBudgets,
  renderMetrics,
  renderMonthFilter,
  renderRecurring,
  renderRules,
  renderSpendingPlan,
  renderSummary,
  renderTransactions,
  renderTrends,
} from "./ledger-render.mjs";

const STORAGE_KEY = "ledger-garden-data-v2";
const IMPORT_PRESET_KEY = "ledger-garden-import-presets-v2";
const MERCHANT_RULES_KEY = "ledger-garden-merchant-rules-v2";
const RULES_KEY = "ledger-garden-rules-v1";
const BUDGETS_KEY = "ledger-garden-budgets-v1";
const SEARCH_DEBOUNCE_MS = 120;
const LEDGER_VERSION = 2;

const currencyFormatter = createCurrencyFormatter();
const dateFormatter = createDateFormatter();
const monthFormatter = createMonthFormatter();

const state = {
  transactions: [],
  monthFilter: "all",
  searchQuery: "",
  parsedImport: null,
  importPresets: {},
  merchantRules: {},
  rules: [],
  budgets: {},
  searchTimer: null,
};

const defaultCategories = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Coffee",
  "Transportation",
  "Travel",
  "Shopping",
  "Health",
  "Insurance",
  "Subscriptions",
  "Entertainment",
  "Income",
  "Transfer",
  "Fees",
  "Taxes",
  "Other",
];

const budgetCategories = defaultCategories.filter((category) => !["Income", "Transfer"].includes(category));

const needsCategories = new Set(["Housing", "Utilities", "Groceries", "Health", "Insurance", "Transportation", "Taxes"]);
const wantsCategories = new Set(["Dining", "Coffee", "Travel", "Shopping", "Entertainment", "Subscriptions"]);

const elements = {
  fileInput: document.querySelector("#file-input"),
  exportButton: document.querySelector("#export-button"),
  saveLedgerButton: document.querySelector("#save-ledger-button"),
  loadLedgerInput: document.querySelector("#load-ledger-input"),
  clearDataButton: document.querySelector("#clear-data-button"),
  mappingPanel: document.querySelector("#mapping-panel"),
  dateColumn: document.querySelector("#date-column"),
  descriptionColumn: document.querySelector("#description-column"),
  merchantColumn: document.querySelector("#merchant-column"),
  amountColumn: document.querySelector("#amount-column"),
  typeColumn: document.querySelector("#type-column"),
  debitColumn: document.querySelector("#debit-column"),
  creditColumn: document.querySelector("#credit-column"),
  accountColumn: document.querySelector("#account-column"),
  institutionInput: document.querySelector("#institution-input"),
  previewHead: document.querySelector("#preview-head"),
  previewBody: document.querySelector("#preview-body"),
  mappingStatus: document.querySelector("#mapping-status"),
  importButton: document.querySelector("#import-button"),
  amountMode: document.querySelector("#amount-mode"),
  rerunCategoriesButton: document.querySelector("#rerun-categories-button"),
  monthFilter: document.querySelector("#month-filter"),
  searchInput: document.querySelector("#search-input"),
  transactionsBody: document.querySelector("#transactions-body"),
  metricSpending: document.querySelector("#metric-spending"),
  metricIncome: document.querySelector("#metric-income"),
  metricCount: document.querySelector("#metric-count"),
  metricMonth: document.querySelector("#metric-month"),
  saveBudgetsButton: document.querySelector("#save-budgets-button"),
  clearBudgetsButton: document.querySelector("#clear-budgets-button"),
  budgetCaption: document.querySelector("#budget-caption"),
  budgetEmpty: document.querySelector("#budget-empty"),
  budgetList: document.querySelector("#budget-list"),
  planEmpty: document.querySelector("#plan-empty"),
  planGrid: document.querySelector("#plan-grid"),
  summaryEmpty: document.querySelector("#summary-empty"),
  summaryList: document.querySelector("#summary-list"),
  trendsEmpty: document.querySelector("#trends-empty"),
  trendsChart: document.querySelector("#trends-chart"),
  recurringEmpty: document.querySelector("#recurring-empty"),
  recurringList: document.querySelector("#recurring-list"),
  accountsEmpty: document.querySelector("#accounts-empty"),
  accountList: document.querySelector("#account-list"),
  transferSummary: document.querySelector("#transfer-summary"),
  rulePatternInput: document.querySelector("#rule-pattern-input"),
  ruleCategorySelect: document.querySelector("#rule-category-select"),
  addRuleButton: document.querySelector("#add-rule-button"),
  rulesEmpty: document.querySelector("#rules-empty"),
  rulesList: document.querySelector("#rules-list"),
  summaryItemTemplate: document.querySelector("#summary-item-template"),
};

initialize();

function initialize() {
  loadSavedData();
  refreshDerivedState();
  bindEvents();
  render();
}

function bindEvents() {
  elements.fileInput.addEventListener("change", handleFileSelection);
  elements.importButton.addEventListener("click", importParsedTransactions);
  elements.exportButton.addEventListener("click", exportFilteredTransactions);
  elements.saveLedgerButton.addEventListener("click", saveLedgerFile);
  elements.loadLedgerInput.addEventListener("change", loadLedgerFile);
  elements.clearDataButton.addEventListener("click", clearAllData);
  elements.rerunCategoriesButton.addEventListener("click", rerunCategories);
  elements.addRuleButton.addEventListener("click", addRuleFromInputs);
  elements.saveBudgetsButton.addEventListener("click", saveBudgetsFromInputs);
  elements.clearBudgetsButton.addEventListener("click", clearBudgetsForActiveMonth);
  bindDropzoneEvents();
  populateRuleCategorySelect();

  elements.monthFilter.addEventListener("change", (event) => {
    state.monthFilter = event.target.value;
    render();
  });

  elements.searchInput.addEventListener("input", (event) => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.searchQuery = event.target.value.trim().toLowerCase();
      render();
    }, SEARCH_DEBOUNCE_MS);
  });
}

function bindDropzoneEvents() {
  const dropzone = document.querySelector(".dropzone");
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer?.files || [];
    if (!file) {
      return;
    }
    elements.fileInput.files = event.dataTransfer.files;
    loadStatementFile(file);
  });
}

function handleFileSelection(event) {
  const [file] = event.target.files;
  if (file) {
    loadStatementFile(file);
  }
}

function loadStatementFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsedImport = parseCsv(String(reader.result || ""));
    if (!parsedImport.headers.length || !parsedImport.rows.length) {
      window.alert("This file does not look like a usable CSV statement.");
      return;
    }

    state.parsedImport = parsedImport;
    buildMappingUi(parsedImport);
  };
  reader.readAsText(file);
}

function buildMappingUi(parsedImport) {
  const columnOptions = ["", ...parsedImport.headers];
  const preset = getImportPreset(parsedImport.headers);
  const guessedAmountColumn = preset?.amount || guessColumn(parsedImport.headers, /^amount$|total amount|transaction amount/i);
  const guessedAmountMode = preset?.amountMode || detectAmountMode(parsedImport.rows, guessedAmountColumn);

  populateSelect(elements.dateColumn, columnOptions, preset?.date || guessColumn(parsedImport.headers, /date|posted|transaction date/i));
  populateSelect(elements.descriptionColumn, columnOptions, preset?.description || guessColumn(parsedImport.headers, /description|details|name/i));
  populateSelect(elements.merchantColumn, columnOptions, preset?.merchant || guessColumn(parsedImport.headers, /raw merchant|merchant/i));
  populateSelect(elements.amountColumn, columnOptions, guessedAmountColumn);
  populateSelect(elements.typeColumn, columnOptions, preset?.type || guessColumn(parsedImport.headers, /type|credit.?debit|debit.?credit|dr.?cr|cr.?dr/i));
  populateSelect(elements.debitColumn, columnOptions, preset?.debit || guessColumn(parsedImport.headers, /debit|withdrawal|outflow|charge/i));
  populateSelect(elements.creditColumn, columnOptions, preset?.credit || guessColumn(parsedImport.headers, /credit|deposit|inflow|payment/i));
  populateSelect(elements.accountColumn, columnOptions, preset?.account || guessColumn(parsedImport.headers, /card last|account|last 4|card/i));
  elements.amountMode.value = guessedAmountMode;
  elements.institutionInput.value = preset?.institution || "";
  renderMappingStatus(parsedImport.headers, preset, guessedAmountMode);
  renderPreviewTable(parsedImport);
  elements.mappingPanel.classList.remove("hidden");
}

function populateSelect(selectElement, options, selectedValue = "") {
  selectElement.innerHTML = "";
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option;
    node.textContent = option || "Not used";
    node.selected = option === selectedValue;
    selectElement.appendChild(node);
  });
}

function renderMappingStatus(headers, preset, amountMode) {
  const modeMessage =
    amountMode === "expense-positive"
      ? "Detected a card-style export where charges are positive and credits are negative."
      : amountMode === "credit-debit-text"
        ? "Detected CR/DR markers in the amount values."
        : "Using signed amounts by default.";

  elements.mappingStatus.textContent = preset
    ? `Loaded a saved mapping for this ${headers.length}-column statement.`
    : `No saved mapping for this statement layout yet. ${modeMessage}`;
  elements.mappingStatus.classList.remove("hidden");
}

function renderPreviewTable(parsedImport) {
  elements.previewHead.innerHTML = "";
  elements.previewBody.innerHTML = "";

  const headerRow = document.createElement("tr");
  parsedImport.headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.appendChild(th);
  });
  elements.previewHead.appendChild(headerRow);

  const fragment = document.createDocumentFragment();
  parsedImport.rows.slice(0, 5).forEach((rowData) => {
    const row = document.createElement("tr");
    parsedImport.headers.forEach((header) => {
      row.appendChild(buildPreviewCell(rowData[header]));
    });
    fragment.appendChild(row);
  });
  elements.previewBody.appendChild(fragment);
}

function buildPreviewCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function importParsedTransactions() {
  if (!state.parsedImport) {
    return;
  }

  const mapping = {
    date: elements.dateColumn.value,
    description: elements.descriptionColumn.value,
    merchant: elements.merchantColumn.value,
    amount: elements.amountColumn.value,
    amountMode: elements.amountMode.value,
    type: elements.typeColumn.value,
    debit: elements.debitColumn.value,
    credit: elements.creditColumn.value,
    account: elements.accountColumn.value,
    institution: elements.institutionInput.value.trim() || "Imported Statement",
  };

  if (!mapping.date || !mapping.description || (!mapping.amount && !mapping.debit && !mapping.credit)) {
    window.alert("Pick at least date, description, and amount information before importing.");
    return;
  }

  const imported = state.parsedImport.rows.map((row) => createTransactionFromRow(row, mapping)).filter(Boolean);
  if (!imported.length) {
    window.alert("No transactions could be created from this statement.");
    return;
  }

  const added = mergeTransactions(imported);
  saveImportPreset(state.parsedImport.headers, mapping);
  refreshDerivedState();
  saveData();
  render();

  elements.mappingPanel.classList.add("hidden");
  elements.fileInput.value = "";
  window.alert(`Imported ${added} new transaction${added === 1 ? "" : "s"}.`);
}

function createTransactionFromRow(row, mapping) {
  const rawDate = row[mapping.date];
  const rawDescription = row[mapping.description];
  if (!rawDate || !rawDescription) {
    return null;
  }

  const amount = resolveAmount(row, mapping);
  const date = normalizeDate(rawDate);
  if (amount === null || !date) {
    return null;
  }

  const description = cleanText(rawDescription);
  const rawMerchant = mapping.merchant ? cleanText(row[mapping.merchant]) : description;
  const merchant = normalizeMerchantLabel(rawMerchant || description);
  const account = mapping.account ? cleanText(row[mapping.account]) : "";
  const institution = mapping.institution;
  const category = categorizeTransaction(merchant, amount);

  return hydrateTransaction({
    id: buildTransactionId(date, description, amount, institution, account),
    date,
    description,
    rawMerchant,
    merchant,
    merchantKey: buildMerchantKey({ merchant, rawMerchant, description }),
    institution,
    account,
    amount,
    category,
    importedAt: new Date().toISOString(),
  });
}

function mergeTransactions(importedTransactions) {
  const result = mergeImportedTransactions(importedTransactions, state.transactions);
  state.transactions = result.transactions;
  return result.added;
}

function clearAllData() {
  if (!window.confirm("Clear every imported transaction and reset the tracker?")) {
    return;
  }
  state.transactions = [];
  state.monthFilter = "all";
  state.searchQuery = "";
  state.parsedImport = null;
  state.importPresets = {};
  state.merchantRules = {};
  state.rules = [];
  state.budgets = {};
  elements.searchInput.value = "";
  elements.loadLedgerInput.value = "";
  elements.mappingPanel.classList.add("hidden");
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(IMPORT_PRESET_KEY);
  window.localStorage.removeItem(MERCHANT_RULES_KEY);
  window.localStorage.removeItem(RULES_KEY);
  window.localStorage.removeItem(BUDGETS_KEY);
  render();
}

function loadSavedData() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(saved.transactions)) {
      state.transactions = saved.transactions.map(hydrateTransaction);
    }
  } catch (error) {
    console.warn("Unable to load saved data.", error);
  }

  try {
    state.importPresets = JSON.parse(window.localStorage.getItem(IMPORT_PRESET_KEY) || "{}");
  } catch (error) {
    console.warn("Unable to load import presets.", error);
    state.importPresets = {};
  }

  try {
    state.merchantRules = JSON.parse(window.localStorage.getItem(MERCHANT_RULES_KEY) || "{}");
  } catch (error) {
    console.warn("Unable to load merchant rules.", error);
    state.merchantRules = {};
  }

  try {
    const savedRules = JSON.parse(window.localStorage.getItem(RULES_KEY) || "[]");
    state.rules = Array.isArray(savedRules) ? savedRules : [];
  } catch (error) {
    console.warn("Unable to load rules.", error);
    state.rules = [];
  }

  try {
    const savedBudgets = JSON.parse(window.localStorage.getItem(BUDGETS_KEY) || "{}");
    state.budgets = isPlainObject(savedBudgets) ? savedBudgets : {};
  } catch (error) {
    console.warn("Unable to load budgets.", error);
    state.budgets = {};
  }
}

function saveData() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ transactions: state.transactions }));
  window.localStorage.setItem(IMPORT_PRESET_KEY, JSON.stringify(state.importPresets));
  window.localStorage.setItem(MERCHANT_RULES_KEY, JSON.stringify(state.merchantRules));
  window.localStorage.setItem(RULES_KEY, JSON.stringify(state.rules));
  window.localStorage.setItem(BUDGETS_KEY, JSON.stringify(state.budgets));
}

function refreshDerivedState() {
  state.transactions = state.transactions
    .map(hydrateTransaction)
    .sort((left, right) => right.date.localeCompare(left.date));

  matchTransfers(state.transactions);
  const recurringMap = detectRecurringSeries(state.transactions);

  state.transactions.forEach((transaction) => {
    const recurring = recurringMap.get(transaction.merchantKey);
    transaction.recurringKey = recurring ? transaction.merchantKey : "";
    transaction.recurringLabel = recurring ? recurring.label : "";
    transaction.recurringCount = recurring ? recurring.count : 0;
    transaction.recurringAverage = recurring ? recurring.averageAmount : 0;
    transaction.searchText = buildSearchText(transaction);
  });
}

function render() {
  renderMonthFilter({
    state,
    elements,
    formatMonthLabel: (value) => formatMonth(value, monthFormatter),
  });
  const monthlyTransactions = getFilteredTransactions({ search: false });
  const budgetMonth = getBudgetMonth();
  const budgetMonthTransactions = getTransactionsForMonth(budgetMonth);
  const budgetRows = buildBudgetRows(budgetMonthTransactions, budgetMonth);
  const spendingPlan = buildSpendingPlan(budgetMonthTransactions);
  renderMetrics({
    state,
    elements,
    visibleTransactions: monthlyTransactions,
    isMoneyMovement,
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
    formatMonthLabel: (value) => formatMonth(value, monthFormatter),
  });
  renderTrends({
    elements,
    months: buildMonthlySeries(state.transactions).slice(-6),
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
    formatMonthLabel: (value) => formatMonth(value, monthFormatter),
  });
  renderSummary({
    elements,
    transactions: monthlyTransactions,
    isMoneyMovement,
    getCategoryBreakdown,
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
  });
  renderBudgets({
    elements,
    budgetMonth,
    budgetRows,
    formatMonthLabel: (value) => formatMonth(value, monthFormatter),
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
  });
  renderSpendingPlan({
    elements,
    planCards: spendingPlan,
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
  });
  renderRules({
    elements,
    rules: state.rules,
    onRemoveRule: (rule) => {
      state.rules = state.rules.filter((current) => current.id !== rule.id);
      if (state.transactions.length) {
        rerunCategories();
      } else {
        saveData();
        render();
      }
    },
  });
  renderRecurring({
    elements,
    recurringSeries: [...detectRecurringSeries(state.transactions).values()].sort((left, right) => right.count - left.count),
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
  });
  renderAccountsAndTransfers({
    elements,
    transactions: state.transactions,
    accountStats: buildAccountStats(state.transactions),
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
  });
  renderTransactions({
    elements,
    visibleTransactions: getFilteredTransactions({ search: true }),
    defaultCategories,
    formatCurrencyValue: (value) => formatCurrency(value, currencyFormatter),
    formatDateValue: (value) => formatDate(value, dateFormatter),
    onCategoryChange: (transaction, category) => {
      clearTransactionSplits(transaction);
      const updatedState = applyLearnedCategoryByMerchant(transaction, category, state.merchantRules, state.transactions);
      state.merchantRules = updatedState.merchantRules;
      state.transactions = updatedState.transactions;
      refreshDerivedState();
      saveData();
      render();
    },
    onEditNote: editTransactionNote,
    onEditSplit: editTransactionSplit,
  });
}

function getFilteredTransactions({ search }) {
  return state.transactions.filter((transaction) => {
    const monthMatches = state.monthFilter === "all" || transaction.date.startsWith(state.monthFilter);
    if (!monthMatches) {
      return false;
    }
    if (!search || !state.searchQuery) {
      return true;
    }
    return transaction.searchText.includes(state.searchQuery);
  });
}

function getTransactionsForMonth(month) {
  return state.transactions.filter((transaction) => transaction.date.startsWith(month));
}

function getBudgetMonth() {
  if (state.monthFilter !== "all") {
    return state.monthFilter;
  }
  if (state.transactions[0]?.date) {
    return state.transactions[0].date.slice(0, 7);
  }
  return new Date().toISOString().slice(0, 7);
}

function getBudgetsForMonth(month) {
  const budgets = state.budgets[month];
  return isPlainObject(budgets) ? budgets : {};
}

function buildBudgetRows(transactions, month) {
  const monthBudgets = getBudgetsForMonth(month);
  if (!transactions.length && !Object.keys(monthBudgets).length) {
    return [];
  }
  const spendingByCategory = new Map();

  transactions
    .filter((transaction) => transaction.amount < 0 && !isMoneyMovement(transaction))
    .forEach((transaction) => {
      getCategoryBreakdown(transaction).forEach((item) => {
        const amount = Math.abs(item.amount);
        spendingByCategory.set(item.category, (spendingByCategory.get(item.category) || 0) + amount);
      });
    });

  return budgetCategories.map((category) => {
    const spent = spendingByCategory.get(category) || 0;
    const budget = Number(monthBudgets[category] || 0);
    const remaining = budget - spent;
    const percentUsed = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0;
    return { category, spent, budget, remaining, percentUsed };
  });
}

function buildSpendingPlan(transactions) {
  const expenses = transactions.filter((transaction) => transaction.amount < 0 && !isMoneyMovement(transaction));
  const income = transactions.filter((transaction) => transaction.amount > 0 && !isMoneyMovement(transaction)).reduce((sum, transaction) => sum + transaction.amount, 0);

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

  const savings = Math.max(0, income - needs - wants);
  const spending = needs + wants;
  if (!transactions.length) {
    return [];
  }

  return [
    { label: "Needs", amount: needs, detail: `${spending > 0 ? Math.round((needs / spending) * 100) : 0}% of spending` },
    { label: "Wants", amount: wants, detail: `${spending > 0 ? Math.round((wants / spending) * 100) : 0}% of spending` },
    { label: "Potential savings", amount: savings, detail: income > 0 ? `${Math.round((savings / income) * 100)}% of income` : "No income in this view" },
    { label: "Subscriptions", amount: subscriptions, detail: "Recurring services in this filtered month" },
  ];
}

function isMoneyMovement(transaction) {
  return transaction.isTransfer;
}

function getImportPreset(headers) {
  return state.importPresets[buildHeaderSignature(headers)] || null;
}

function saveImportPreset(headers, mapping) {
  state.importPresets[buildHeaderSignature(headers)] = mapping;
}

function buildHeaderSignature(headers) {
  return headers.map((header) => header.trim().toLowerCase()).join("|");
}

function rerunCategories() {
  if (!state.transactions.length) {
    window.alert("There are no transactions to recategorize yet.");
    return;
  }
  state.transactions = state.transactions.map((transaction) =>
    hydrateTransaction({
      ...transaction,
      category: categorizeTransaction(transaction.merchant || transaction.description, transaction.amount),
      splits: recategorizeSplits(transaction, categorizeTransaction),
    }),
  );
  refreshDerivedState();
  saveData();
  render();
  window.alert("Re-ran category rules across all transactions.");
}

function guessColumn(headers, pattern) {
  return headers.find((header) => pattern.test(header)) || "";
}

function exportFilteredTransactions() {
  const visibleTransactions = getFilteredTransactions({ search: true });
  if (!visibleTransactions.length) {
    window.alert("There are no filtered transactions to export.");
    return;
  }

  const rows = [
    ["Date", "Description", "Merchant", "Institution", "Account", "Category", "Flags", "Note", "Amount"],
    ...visibleTransactions.map((transaction) => [
      transaction.date,
      transaction.description,
      transaction.merchant,
      transaction.institution,
      transaction.account,
      transaction.category,
      buildFlagLabel(transaction),
      transaction.note || "",
      transaction.amount.toFixed(2),
    ]),
  ];

  downloadBlob(
    new Blob([rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }),
    `ledger-garden-${state.monthFilter === "all" ? "all-months" : state.monthFilter}.csv`,
  );
}

function saveLedgerFile() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: LEDGER_VERSION,
    transactions: state.transactions,
    importPresets: state.importPresets,
    merchantRules: state.merchantRules,
    rules: state.rules,
    budgets: state.budgets,
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `ledger-garden-ledger-${new Date().toISOString().slice(0, 10)}.json`);
}

function loadLedgerFile(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      state.transactions = Array.isArray(payload.transactions) ? payload.transactions.map(hydrateTransaction) : [];
      state.importPresets = isPlainObject(payload.importPresets) ? payload.importPresets : {};
      state.merchantRules = isPlainObject(payload.merchantRules) ? payload.merchantRules : {};
      state.rules = Array.isArray(payload.rules) ? payload.rules : [];
      state.budgets = isPlainObject(payload.budgets) ? payload.budgets : {};
      state.monthFilter = "all";
      state.searchQuery = "";
      state.parsedImport = null;
      elements.searchInput.value = "";
      refreshDerivedState();
      saveData();
      render();
      window.alert("Ledger file loaded successfully.");
    } catch (error) {
      console.error("Unable to load ledger file.", error);
      window.alert("That file does not look like a valid Ledger Garden ledger.");
    } finally {
      elements.loadLedgerInput.value = "";
    }
  };
  reader.readAsText(file);
}

function populateRuleCategorySelect() {
  elements.ruleCategorySelect.innerHTML = "";
  defaultCategories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.ruleCategorySelect.appendChild(option);
  });
}

function addRuleFromInputs() {
  const pattern = cleanText(elements.rulePatternInput.value).toLowerCase();
  const category = elements.ruleCategorySelect.value;
  if (!pattern || !category) {
    window.alert("Add a merchant pattern and category first.");
    return;
  }

  state.rules.push({
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pattern,
    category,
  });
  elements.rulePatternInput.value = "";
  if (state.transactions.length) {
    rerunCategories();
  } else {
    saveData();
    render();
  }
}

function saveBudgetsFromInputs() {
  const budgetMonth = getBudgetMonth();
  const nextBudgets = {};

  elements.budgetList.querySelectorAll(".budget-input").forEach((input) => {
    const category = input.dataset.category;
    const value = Number.parseFloat(input.value);
    if (category && Number.isFinite(value) && value > 0) {
      nextBudgets[category] = Number(value.toFixed(2));
    }
  });

  if (!Object.keys(nextBudgets).length) {
    window.alert("Add at least one positive budget amount for this month.");
    return;
  }

  state.budgets[budgetMonth] = nextBudgets;
  saveData();
  render();
  window.alert(`Saved budgets for ${formatMonth(budgetMonth, monthFormatter)}.`);
}

function clearBudgetsForActiveMonth() {
  const budgetMonth = getBudgetMonth();
  delete state.budgets[budgetMonth];
  saveData();
  render();
}

function editTransactionNote(transaction) {
  const response = window.prompt("Add a private note for this transaction.", transaction.note || "");
  if (response === null) {
    return;
  }

  transaction.note = cleanText(response);
  refreshDerivedState();
  saveData();
  render();
}

function editTransactionSplit(transaction) {
  const currentValue = transaction.splits?.length
    ? transaction.splits.map((split) => `${split.category}:${Math.abs(split.amount).toFixed(2)}`).join(", ")
    : "";
  const response = window.prompt(
    "Enter splits like Groceries:52.10, Household:21.30. Use positive amounts. Leave empty to clear splits.",
    currentValue,
  );

  if (response === null) {
    return;
  }

  if (!response.trim()) {
    clearTransactionSplits(transaction);
    refreshDerivedState();
    saveData();
    render();
    return;
  }

  const parsed = parseSplitInput(response, transaction.amount);
  if (!parsed) {
    window.alert("The split format is invalid or the amounts do not add up.");
    return;
  }

  transaction.splits = parsed;
  transaction.category = "Other";
  refreshDerivedState();
  saveData();
  render();
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function categorizeTransaction(merchant, amount) {
  return inferCategory({
    merchant,
    amount,
    rules: state.rules,
    merchantRules: state.merchantRules,
    categoryMatchers: categoryRules,
  });
}
