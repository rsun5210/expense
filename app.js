import {
  buildMerchantKey,
  cleanText,
  detectAmountMode,
  escapeCsvValue,
  isPlainObject,
  normalizeDate,
  normalizeMerchantLabel,
  parseCsv,
  resolveAmount,
} from "./ledger-core.mjs";
import {
  applyLearnedCategory as applyLearnedCategoryByMerchant,
  buildAccountStats,
  buildBudgetRows as buildBudgetRowsFromTransactions,
  buildLedgerPayload,
  buildMonthlySeries,
  buildSearchText,
  buildSpendingPlan as buildSpendingPlanCards,
  buildTransactionId,
  categoryRules,
  clearTransactionSplits,
  detectRecurringSeries,
  getCategoryBreakdown,
  hydrateTransaction,
  inferCategory,
  matchTransfers,
  mergeTransactions as mergeImportedTransactions,
  parseLedgerPayload,
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
  toastTimer: null,
  dialogResolver: null,
  dialogOptions: null,
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
  loadSampleButton: document.querySelector("#load-sample-button"),
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
  copyBudgetsButton: document.querySelector("#copy-budgets-button"),
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
  toastRegion: document.querySelector("#toast-region"),
  dialogBackdrop: document.querySelector("#dialog-backdrop"),
  dialogEyebrow: document.querySelector("#dialog-eyebrow"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDescription: document.querySelector("#dialog-description"),
  dialogField: document.querySelector("#dialog-field"),
  dialogFieldLabel: document.querySelector("#dialog-field-label"),
  dialogInput: document.querySelector("#dialog-input"),
  splitBuilder: document.querySelector("#split-builder"),
  splitRows: document.querySelector("#split-rows"),
  splitAddRowButton: document.querySelector("#split-add-row-button"),
  dialogError: document.querySelector("#dialog-error"),
  dialogCancelButton: document.querySelector("#dialog-cancel-button"),
  dialogConfirmButton: document.querySelector("#dialog-confirm-button"),
};

initialize();

function initialize() {
  loadSavedData();
  refreshDerivedState();
  bindEvents();
  render();
}

function showToast(message, tone = "info") {
  window.clearTimeout(state.toastTimer);
  elements.toastRegion.innerHTML = "";

  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);

  state.toastTimer = window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function openDialog({
  title,
  description = "",
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  value = "",
  fieldLabel = "Details",
  placeholder = "",
  rows = 4,
  mode = "text",
  tone = "primary",
  validate = null,
  splitRows = [],
  transactionAmount = 0,
} = {}) {
  if (state.dialogResolver) {
    closeDialog({ confirmed: false });
  }

  state.dialogOptions = { mode, validate, transactionAmount };
  elements.dialogEyebrow.textContent = mode === "confirm" ? "Confirm action" : "Update details";
  elements.dialogTitle.textContent = title;
  elements.dialogDescription.textContent = description;
  elements.dialogCancelButton.textContent = cancelLabel;
  elements.dialogConfirmButton.textContent = confirmLabel;
  elements.dialogConfirmButton.classList.toggle("danger", tone === "danger");
  elements.dialogFieldLabel.textContent = fieldLabel;
  elements.dialogInput.value = value;
  elements.dialogInput.placeholder = placeholder;
  elements.dialogInput.rows = rows;
  elements.dialogError.textContent = "";
  elements.dialogError.classList.add("hidden");
  elements.dialogField.classList.toggle("hidden", mode === "confirm" || mode === "split");
  elements.splitBuilder.classList.toggle("hidden", mode !== "split");
  if (mode === "split") {
    renderSplitRows(splitRows, transactionAmount);
  } else {
    elements.splitRows.innerHTML = "";
  }
  elements.dialogBackdrop.classList.remove("hidden");

  window.setTimeout(() => {
    if (mode === "split") {
      elements.splitRows.querySelector("select, input")?.focus();
    } else if (mode !== "confirm") {
      elements.dialogInput.focus();
      elements.dialogInput.setSelectionRange(elements.dialogInput.value.length, elements.dialogInput.value.length);
    } else {
      elements.dialogConfirmButton.focus();
    }
  }, 0);

  return new Promise((resolve) => {
    state.dialogResolver = resolve;
  });
}

function closeDialog(result) {
  if (!state.dialogResolver) {
    return;
  }

  const resolve = state.dialogResolver;
  state.dialogResolver = null;
  state.dialogOptions = null;
  elements.dialogBackdrop.classList.add("hidden");
  resolve(result);
}

function submitDialog() {
  if (!state.dialogResolver) {
    return;
  }

  const options = state.dialogOptions || {};
  const value =
    options.mode === "confirm"
      ? ""
      : options.mode === "split"
        ? collectSplitBuilderValue(options.transactionAmount)
        : elements.dialogInput.value;
  const error = typeof options.validate === "function" ? options.validate(value) : "";
  if (error) {
    elements.dialogError.textContent = error;
    elements.dialogError.classList.remove("hidden");
    return;
  }

  closeDialog({ confirmed: true, value });
}

function promptForText(options) {
  return openDialog({ ...options, mode: "text" });
}

function promptForSplit(options) {
  return openDialog({ ...options, mode: "split" });
}

function promptForConfirmation(options) {
  return openDialog({ ...options, mode: "confirm" });
}

function bindEvents() {
  elements.fileInput.addEventListener("change", handleFileSelection);
  elements.importButton.addEventListener("click", importParsedTransactions);
  elements.exportButton.addEventListener("click", exportFilteredTransactions);
  elements.saveLedgerButton.addEventListener("click", saveLedgerFile);
  elements.loadLedgerInput.addEventListener("change", loadLedgerFile);
  elements.loadSampleButton.addEventListener("click", importSampleStatement);
  elements.clearDataButton.addEventListener("click", clearAllData);
  elements.rerunCategoriesButton.addEventListener("click", rerunCategories);
  elements.addRuleButton.addEventListener("click", addRuleFromInputs);
  elements.saveBudgetsButton.addEventListener("click", saveBudgetsFromInputs);
  elements.clearBudgetsButton.addEventListener("click", clearBudgetsForActiveMonth);
  elements.copyBudgetsButton.addEventListener("click", copyBudgetsFromPreviousMonth);
  bindDropzoneEvents();
  bindDialogEvents();
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

function bindDialogEvents() {
  elements.dialogCancelButton.addEventListener("click", () => closeDialog({ confirmed: false }));
  elements.dialogConfirmButton.addEventListener("click", submitDialog);
  elements.splitAddRowButton.addEventListener("click", () => addSplitRow());
  elements.dialogInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      submitDialog();
    }
  });
  elements.dialogBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.dialogBackdrop) {
      closeDialog({ confirmed: false });
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.dialogResolver) {
      closeDialog({ confirmed: false });
    }
  });
}

function getSplitCategoryOptions() {
  return defaultCategories.filter((category) => !["Income", "Transfer"].includes(category));
}

function renderSplitRows(splitRows = [], transactionAmount = 0) {
  elements.splitRows.innerHTML = "";
  const normalizedRows =
    splitRows.length > 0
      ? splitRows.map((split) => ({
          category: split.category || "Other",
          amount: Math.abs(Number(split.amount || 0)),
        }))
      : [
          {
            category: "Other",
            amount: Math.abs(transactionAmount || 0),
          },
        ];

  normalizedRows.forEach((split) => addSplitRow(split));
}

function addSplitRow(split = { category: "Other", amount: 0 }) {
  const row = document.createElement("div");
  row.className = "split-row";

  const categoryLabel = document.createElement("label");
  categoryLabel.innerHTML = "<span>Category</span>";
  const categorySelect = document.createElement("select");
  categorySelect.className = "split-category-select";
  getSplitCategoryOptions().forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    option.selected = category === split.category;
    categorySelect.appendChild(option);
  });
  categoryLabel.appendChild(categorySelect);

  const amountLabel = document.createElement("label");
  amountLabel.innerHTML = "<span>Amount</span>";
  const amountInput = document.createElement("input");
  amountInput.className = "split-amount-input";
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.placeholder = "0.00";
  amountInput.value = split.amount ? Number(split.amount).toFixed(2) : "";
  amountLabel.appendChild(amountInput);

  const removeButton = document.createElement("button");
  removeButton.className = "ghost-button small-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    row.remove();
  });

  row.appendChild(categoryLabel);
  row.appendChild(amountLabel);
  row.appendChild(removeButton);
  elements.splitRows.appendChild(row);
}

function collectSplitBuilderValue(transactionAmount) {
  const rows = [...elements.splitRows.querySelectorAll(".split-row")].map((row) => ({
    category: row.querySelector(".split-category-select")?.value || "",
    amount: Number.parseFloat(row.querySelector(".split-amount-input")?.value || ""),
  }));

  const filledRows = rows.filter((row) => row.category || Number.isFinite(row.amount));
  if (!filledRows.length) {
    return [];
  }

  return filledRows.map((row) => ({
    category: row.category,
    amount: transactionAmount < 0 ? -Math.abs(row.amount) : Math.abs(row.amount),
  }));
}

function validateSplitBuilderValue(value, transactionAmount) {
  if (!Array.isArray(value) || !value.length) {
    return "";
  }

  for (const split of value) {
    if (!split.category || !Number.isFinite(split.amount) || Math.abs(split.amount) <= 0) {
      return "Each split row needs a category and a positive amount.";
    }
  }

  const total = value.reduce((sum, split) => sum + split.amount, 0);
  if (Math.abs(total - transactionAmount) > 0.02) {
    return "The split amounts need to add up to the full transaction total.";
  }

  return "";
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
      showToast("This file does not look like a usable CSV statement.", "error");
      return;
    }

    state.parsedImport = parsedImport;
    buildMappingUi(parsedImport);
  };
  reader.readAsText(file);
}

function buildMappingUi(parsedImport) {
  const suggestedMapping = buildSuggestedMapping(parsedImport);
  const columnOptions = ["", ...parsedImport.headers];
  populateSelect(elements.dateColumn, columnOptions, suggestedMapping.date);
  populateSelect(elements.descriptionColumn, columnOptions, suggestedMapping.description);
  populateSelect(elements.merchantColumn, columnOptions, suggestedMapping.merchant);
  populateSelect(elements.amountColumn, columnOptions, suggestedMapping.amount);
  populateSelect(elements.typeColumn, columnOptions, suggestedMapping.type);
  populateSelect(elements.debitColumn, columnOptions, suggestedMapping.debit);
  populateSelect(elements.creditColumn, columnOptions, suggestedMapping.credit);
  populateSelect(elements.accountColumn, columnOptions, suggestedMapping.account);
  elements.amountMode.value = suggestedMapping.amountMode;
  elements.institutionInput.value = suggestedMapping.institution;
  renderMappingStatus(parsedImport.headers, getImportPreset(parsedImport.headers), suggestedMapping.amountMode);
  renderPreviewTable(parsedImport);
  elements.mappingPanel.classList.remove("hidden");
}

function buildSuggestedMapping(parsedImport) {
  const preset = getImportPreset(parsedImport.headers);
  const guessedAmountColumn = preset?.amount || guessColumn(parsedImport.headers, /^amount$|total amount|transaction amount/i);

  return {
    date: preset?.date || guessColumn(parsedImport.headers, /date|posted|transaction date/i),
    description: preset?.description || guessColumn(parsedImport.headers, /description|details|name/i),
    merchant: preset?.merchant || guessColumn(parsedImport.headers, /raw merchant|merchant/i),
    amount: guessedAmountColumn,
    amountMode: preset?.amountMode || detectAmountMode(parsedImport.rows, guessedAmountColumn),
    type: preset?.type || guessColumn(parsedImport.headers, /type|credit.?debit|debit.?credit|dr.?cr|cr.?dr/i),
    debit: preset?.debit || guessColumn(parsedImport.headers, /debit|withdrawal|outflow|charge/i),
    credit: preset?.credit || guessColumn(parsedImport.headers, /credit|deposit|inflow|payment/i),
    account: preset?.account || guessColumn(parsedImport.headers, /card last|account|last 4|card/i),
    institution: preset?.institution || "",
  };
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

function collectMappingInputs() {
  return {
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
}

function importParsedTransactions(options = {}) {
  const parsedImport = options.parsedImport || state.parsedImport;
  if (!parsedImport) {
    return false;
  }

  const mapping = options.mapping || collectMappingInputs();
  if (!mapping.date || !mapping.description || (!mapping.amount && !mapping.debit && !mapping.credit)) {
    showToast("Pick at least date, description, and amount information before importing.", "error");
    return false;
  }

  const imported = parsedImport.rows.map((row) => createTransactionFromRow(row, mapping)).filter(Boolean);
  if (!imported.length) {
    showToast("No transactions could be created from this statement.", "error");
    return false;
  }

  const added = mergeTransactions(imported);
  saveImportPreset(parsedImport.headers, mapping);
  refreshDerivedState();
  saveData();
  render();

  elements.mappingPanel.classList.add("hidden");
  elements.fileInput.value = "";
  if (!options.keepParsedImport) {
    state.parsedImport = null;
  }
  showToast(`Imported ${added} new transaction${added === 1 ? "" : "s"}.`, "success");
  return true;
}

async function importSampleStatement() {
  try {
    const response = await window.fetch("./sample-data/sample_statement.csv");
    if (!response.ok) {
      throw new Error(`Sample file request failed with ${response.status}.`);
    }

    const parsedImport = parseCsv(await response.text());
    if (!parsedImport.headers.length || !parsedImport.rows.length) {
      throw new Error("Sample file did not contain usable rows.");
    }

    state.parsedImport = parsedImport;
    buildMappingUi(parsedImport);
    importParsedTransactions({
      parsedImport,
      mapping: {
        ...buildSuggestedMapping(parsedImport),
        institution: "Pocket Ledger Sample",
      },
    });
  } catch (error) {
    console.error("Unable to import sample statement.", error);
    showToast("The sample CSV could not be loaded right now.", "error");
  }
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

async function clearAllData() {
  const result = await promptForConfirmation({
    title: "Clear all imported data?",
    description: "This removes transactions, saved budgets, rules, presets, and local browser storage for Pocket Ledger on this device.",
    confirmLabel: "Clear everything",
    tone: "danger",
  });
  if (!result.confirmed) {
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
  showToast("Pocket Ledger has been reset on this browser.", "success");
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
    onRemoveRule: async (rule) => {
      const result = await promptForConfirmation({
        title: "Remove automation rule?",
        description: `This will stop auto-categorizing merchants that match "${rule.pattern}".`,
        confirmLabel: "Remove rule",
      });
      if (!result.confirmed) {
        return;
      }
      state.rules = state.rules.filter((current) => current.id !== rule.id);
      if (state.transactions.length) {
        rerunCategories({ silent: true });
      } else {
        saveData();
        render();
      }
      showToast("Rule removed.", "success");
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
  return buildBudgetRowsFromTransactions({
    transactions,
    monthBudgets,
    budgetCategories,
    isMoneyMovement,
    getCategoryBreakdown,
  });
}

function buildSpendingPlan(transactions) {
  return buildSpendingPlanCards({
    transactions,
    isMoneyMovement,
    getCategoryBreakdown,
    needsCategories,
    wantsCategories,
  });
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

function rerunCategories({ silent = false } = {}) {
  if (!state.transactions.length) {
    if (!silent) {
      showToast("There are no transactions to recategorize yet.", "error");
    }
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
  if (!silent) {
    showToast("Re-ran category rules across all transactions.", "success");
  }
}

function guessColumn(headers, pattern) {
  return headers.find((header) => pattern.test(header)) || "";
}

function exportFilteredTransactions() {
  const visibleTransactions = getFilteredTransactions({ search: true });
  if (!visibleTransactions.length) {
    showToast("There are no filtered transactions to export.", "error");
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
    `pocket-ledger-${state.monthFilter === "all" ? "all-months" : state.monthFilter}.csv`,
  );
}

function saveLedgerFile() {
  const payload = buildLedgerPayload({
    exportedAt: new Date().toISOString(),
    version: LEDGER_VERSION,
    transactions: state.transactions,
    importPresets: state.importPresets,
    merchantRules: state.merchantRules,
    rules: state.rules,
    budgets: state.budgets,
  });
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `pocket-ledger-ledger-${new Date().toISOString().slice(0, 10)}.json`);
  showToast("Ledger JSON downloaded.", "success");
}

function loadLedgerFile(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = parseLedgerPayload(JSON.parse(String(reader.result || "{}")));
      state.transactions = payload.transactions;
      state.importPresets = payload.importPresets;
      state.merchantRules = payload.merchantRules;
      state.rules = payload.rules;
      state.budgets = payload.budgets;
      state.monthFilter = "all";
      state.searchQuery = "";
      state.parsedImport = null;
      elements.searchInput.value = "";
      refreshDerivedState();
      saveData();
      render();
      showToast("Ledger file loaded successfully.", "success");
    } catch (error) {
      console.error("Unable to load ledger file.", error);
      showToast("That file does not look like a valid Pocket Ledger ledger.", "error");
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
    showToast("Add a merchant pattern and category first.", "error");
    return;
  }

  state.rules.push({
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pattern,
    category,
  });
  elements.rulePatternInput.value = "";
  if (state.transactions.length) {
    rerunCategories({ silent: true });
  } else {
    saveData();
    render();
  }
  showToast(`Added a rule for "${pattern}".`, "success");
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
    showToast("Add at least one positive budget amount for this month.", "error");
    return;
  }

  state.budgets[budgetMonth] = nextBudgets;
  saveData();
  render();
  showToast(`Saved budgets for ${formatMonth(budgetMonth, monthFormatter)}.`, "success");
}

function copyBudgetsFromPreviousMonth() {
  const budgetMonth = getBudgetMonth();
  const previousMonth = Object.keys(state.budgets)
    .filter((month) => month < budgetMonth && Object.keys(getBudgetsForMonth(month)).length)
    .sort()
    .pop();

  if (!previousMonth) {
    showToast("There is no earlier saved budget month to copy from yet.", "error");
    return;
  }

  state.budgets[budgetMonth] = { ...getBudgetsForMonth(previousMonth) };
  saveData();
  render();
  showToast(
    `Copied budgets from ${formatMonth(previousMonth, monthFormatter)} into ${formatMonth(budgetMonth, monthFormatter)}.`,
    "success",
  );
}

async function clearBudgetsForActiveMonth() {
  const budgetMonth = getBudgetMonth();
  if (!Object.keys(getBudgetsForMonth(budgetMonth)).length) {
    showToast(`There are no saved budgets for ${formatMonth(budgetMonth, monthFormatter)} yet.`, "error");
    return;
  }

  const result = await promptForConfirmation({
    title: `Clear budgets for ${formatMonth(budgetMonth, monthFormatter)}?`,
    description: "This only removes the saved targets for the selected month.",
    confirmLabel: "Clear budgets",
  });
  if (!result.confirmed) {
    return;
  }

  delete state.budgets[budgetMonth];
  saveData();
  render();
  showToast(`Cleared budgets for ${formatMonth(budgetMonth, monthFormatter)}.`, "success");
}

async function editTransactionNote(transaction) {
  const result = await promptForText({
    title: "Private transaction note",
    description: "Notes stay in this browser and are searchable in your ledger.",
    confirmLabel: "Save note",
    fieldLabel: "Note",
    value: transaction.note || "",
    placeholder: "Add context for this transaction",
  });
  if (!result.confirmed) {
    return;
  }

  transaction.note = cleanText(result.value);
  refreshDerivedState();
  saveData();
  render();
  showToast(transaction.note ? "Note saved." : "Note cleared.", "success");
}

async function editTransactionSplit(transaction) {
  const hasExistingSplit = Boolean(transaction.splits?.length);
  const result = await promptForSplit({
    title: "Split this transaction",
    description: "Pick categories from the dropdown and enter positive amounts. Remove all rows if you want to clear the split.",
    confirmLabel: hasExistingSplit ? "Update split" : "Save split",
    splitRows: transaction.splits?.length ? transaction.splits : [{ category: transaction.category || "Other", amount: Math.abs(transaction.amount) }],
    transactionAmount: transaction.amount,
    validate: (value) => {
      return validateSplitBuilderValue(value, transaction.amount);
    },
  });

  if (!result.confirmed) {
    return;
  }

  if (!result.value.length) {
    clearTransactionSplits(transaction);
    refreshDerivedState();
    saveData();
    render();
    showToast("Split cleared.", "success");
    return;
  }

  transaction.splits = result.value;
  transaction.category = "Other";
  refreshDerivedState();
  saveData();
  render();
  showToast("Split saved.", "success");
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
