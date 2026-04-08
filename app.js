import {
  applyDirectionToAmount,
  buildMerchantKey,
  cleanText,
  daysBetween,
  detectAmountMode,
  escapeCsvValue,
  inferDirectionFromText,
  isPlainObject,
  normalizeDate,
  normalizeMerchantKey,
  normalizeMerchantLabel,
  parseAmountDetails,
  parseCsv,
  parseCurrency,
  parseSplitInput,
  resolveAmount,
} from "./ledger-core.mjs";

const STORAGE_KEY = "ledger-garden-data-v2";
const IMPORT_PRESET_KEY = "ledger-garden-import-presets-v2";
const MERCHANT_RULES_KEY = "ledger-garden-merchant-rules-v2";
const RULES_KEY = "ledger-garden-rules-v1";
const SEARCH_DEBOUNCE_MS = 120;
const LEDGER_VERSION = 2;

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });

const state = {
  transactions: [],
  monthFilter: "all",
  searchQuery: "",
  parsedImport: null,
  importPresets: {},
  merchantRules: {},
  rules: [],
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

const categoryRules = [
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
      renderTransactions(getFilteredTransactions({ search: true }));
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
      row.appendChild(buildCell(rowData[header]));
    });
    fragment.appendChild(row);
  });
  elements.previewBody.appendChild(fragment);
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
  const category = inferCategory(merchant, amount);

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

function inferCategory(merchant, amount) {
  const ruleCategory = matchRuleCategory(merchant);
  if (ruleCategory) {
    return ruleCategory;
  }

  const learnedCategory = state.merchantRules[normalizeMerchantKey(merchant)];
  if (learnedCategory) {
    return learnedCategory;
  }
  if (isTransferLikeText(merchant)) {
    return "Transfer";
  }
  if (amount > 0) {
    const incomeMatch = categoryRules.find((rule) => rule.category === "Income" && rule.match.test(merchant));
    return incomeMatch ? "Income" : "Other";
  }
  const match = categoryRules.find((rule) => rule.match.test(merchant));
  return match ? match.category : "Other";
}

function isTransferLikeText(value) {
  return /refund|reversal|statement credit|credit back|payment|autopay|transfer|venmo|zelle|bilt rewards|bilt housing/i.test(value);
}

function buildTransactionId(date, description, amount, institution, account) {
  return [date, description.toLowerCase(), amount.toFixed(2), institution.toLowerCase(), String(account || "").toLowerCase()].join("::");
}

function mergeTransactions(importedTransactions) {
  const existingIds = new Set(state.transactions.map((transaction) => transaction.id));
  let added = 0;
  importedTransactions.forEach((transaction) => {
    if (!existingIds.has(transaction.id) && !isLikelyDuplicate(transaction, state.transactions)) {
      state.transactions.push(transaction);
      existingIds.add(transaction.id);
      added += 1;
    }
  });
  state.transactions.sort((left, right) => right.date.localeCompare(left.date));
  return added;
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
  elements.searchInput.value = "";
  elements.loadLedgerInput.value = "";
  elements.mappingPanel.classList.add("hidden");
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(IMPORT_PRESET_KEY);
  window.localStorage.removeItem(MERCHANT_RULES_KEY);
  window.localStorage.removeItem(RULES_KEY);
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
}

function saveData() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ transactions: state.transactions }));
  window.localStorage.setItem(IMPORT_PRESET_KEY, JSON.stringify(state.importPresets));
  window.localStorage.setItem(MERCHANT_RULES_KEY, JSON.stringify(state.merchantRules));
  window.localStorage.setItem(RULES_KEY, JSON.stringify(state.rules));
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
  renderMonthFilter();
  const monthlyTransactions = getFilteredTransactions({ search: false });
  renderMetrics(monthlyTransactions);
  renderTrends();
  renderSummary(monthlyTransactions);
  renderRules();
  renderRecurring();
  renderAccountsAndTransfers();
  renderTransactions(getFilteredTransactions({ search: true }));
}

function renderMonthFilter() {
  const months = Array.from(new Set(state.transactions.map((transaction) => transaction.date.slice(0, 7)))).sort().reverse();
  const currentValue = months.includes(state.monthFilter) ? state.monthFilter : "all";
  state.monthFilter = currentValue;
  elements.monthFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All months";
  elements.monthFilter.appendChild(allOption);

  months.forEach((month) => {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = formatMonth(month);
    option.selected = month === currentValue;
    elements.monthFilter.appendChild(option);
  });
}

function renderMetrics(visibleTransactions) {
  const spending = visibleTransactions.filter((item) => item.amount < 0 && !isMoneyMovement(item)).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const income = visibleTransactions.filter((item) => item.amount > 0 && !isMoneyMovement(item)).reduce((sum, item) => sum + item.amount, 0);
  const activeMonth =
    state.monthFilter === "all"
      ? visibleTransactions[0]?.date
        ? formatMonth(visibleTransactions[0].date.slice(0, 7))
        : "All data"
      : formatMonth(state.monthFilter);

  elements.metricSpending.textContent = formatCurrency(spending);
  elements.metricIncome.textContent = formatCurrency(income);
  elements.metricCount.textContent = String(visibleTransactions.length);
  elements.metricMonth.textContent = activeMonth;
}

function renderTrends() {
  const months = buildMonthlySeries(state.transactions).slice(-6);
  elements.trendsChart.innerHTML = "";
  if (months.length < 2) {
    elements.trendsEmpty.hidden = false;
    return;
  }

  elements.trendsEmpty.hidden = true;
  const maxValue = Math.max(...months.flatMap((month) => [month.spending, month.income]), 1);
  const fragment = document.createDocumentFragment();

  months.forEach((month) => {
    const card = document.createElement("article");
    card.className = "trend-card";
    card.innerHTML = `
      <div class="trend-top">
        <strong>${formatMonth(month.month)}</strong>
        <span>Net ${formatCurrency(month.income - month.spending)}</span>
      </div>
      <div class="trend-bars">
        <div class="trend-bar-row">
          <span>Spend</span>
          <div class="trend-bar-shell"><div class="trend-bar spend" style="width:${(month.spending / maxValue) * 100}%"></div></div>
          <strong>${formatCurrency(month.spending)}</strong>
        </div>
        <div class="trend-bar-row">
          <span>Income</span>
          <div class="trend-bar-shell"><div class="trend-bar income" style="width:${(month.income / maxValue) * 100}%"></div></div>
          <strong>${formatCurrency(month.income)}</strong>
        </div>
      </div>
    `;
    fragment.appendChild(card);
  });

  elements.trendsChart.appendChild(fragment);
}

function renderSummary(transactions) {
  const visibleTransactions = transactions.filter((item) => item.amount < 0 && !isMoneyMovement(item));
  elements.summaryList.innerHTML = "";
  if (!visibleTransactions.length) {
    elements.summaryEmpty.hidden = false;
    return;
  }

  elements.summaryEmpty.hidden = true;
  const grouped = new Map();
  visibleTransactions.forEach((transaction) => {
    const items = getCategoryBreakdown(transaction);
    items.forEach((item) => {
      const existing = grouped.get(item.category) || { amount: 0, count: 0 };
      existing.amount += Math.abs(item.amount);
      existing.count += 1;
      grouped.set(item.category, existing);
    });
  });

  const fragment = document.createDocumentFragment();
  [...grouped.entries()]
    .sort((left, right) => right[1].amount - left[1].amount)
    .forEach(([category, stats]) => {
      const node = elements.summaryItemTemplate.content.cloneNode(true);
      node.querySelector(".summary-name").textContent = category;
      node.querySelector(".summary-count").textContent = `${stats.count} transaction${stats.count === 1 ? "" : "s"}`;
      node.querySelector(".summary-amount").textContent = formatCurrency(stats.amount);
      fragment.appendChild(node);
    });
  elements.summaryList.appendChild(fragment);
}

function renderRules() {
  elements.rulesList.innerHTML = "";
  if (!state.rules.length) {
    elements.rulesEmpty.hidden = false;
    return;
  }

  elements.rulesEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  state.rules.forEach((rule) => {
    const row = document.createElement("article");
    row.className = "mini-card rule-card";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(rule.pattern)}</strong>
        <p>Category: ${escapeHtml(rule.category)}</p>
      </div>
    `;
    const button = document.createElement("button");
    button.className = "ghost-button small-button";
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", () => {
      state.rules = state.rules.filter((current) => current.id !== rule.id);
      if (state.transactions.length) {
        rerunCategories();
      } else {
        saveData();
        renderRules();
      }
    });
    row.appendChild(button);
    fragment.appendChild(row);
  });
  elements.rulesList.appendChild(fragment);
}

function renderRecurring() {
  elements.recurringList.innerHTML = "";
  const recurringSeries = [...detectRecurringSeries(state.transactions).values()].sort((left, right) => right.count - left.count);
  if (!recurringSeries.length) {
    elements.recurringEmpty.hidden = false;
    return;
  }

  elements.recurringEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  recurringSeries.forEach((series) => {
    const item = document.createElement("article");
    item.className = "mini-card";
    item.innerHTML = `
      <div>
        <strong>${series.label}</strong>
        <p>${series.count} charges across ${series.monthCount} months</p>
      </div>
      <div class="mini-card-value">
        <strong>${formatCurrency(series.averageAmount)}</strong>
        <span>${series.frequencyLabel}</span>
      </div>
    `;
    fragment.appendChild(item);
  });
  elements.recurringList.appendChild(fragment);
}

function renderAccountsAndTransfers() {
  elements.accountList.innerHTML = "";
  elements.transferSummary.innerHTML = "";

  const accountStats = buildAccountStats(state.transactions);
  if (!accountStats.length) {
    elements.accountsEmpty.hidden = false;
  } else {
    elements.accountsEmpty.hidden = true;
    const fragment = document.createDocumentFragment();
    accountStats.forEach((account) => {
      const item = document.createElement("article");
      item.className = "mini-card";
      item.innerHTML = `
        <div>
          <strong>${account.label}</strong>
          <p>${account.count} transaction${account.count === 1 ? "" : "s"}</p>
        </div>
        <div class="mini-card-value">
          <strong>${formatCurrency(account.spending)}</strong>
          <span>${account.institution}</span>
        </div>
      `;
      fragment.appendChild(item);
    });
    elements.accountList.appendChild(fragment);
  }

  const matchedTransfers = state.transactions.filter((transaction) => transaction.transferMatchId).length / 2;
  const unmatchedTransfers = state.transactions.filter((transaction) => transaction.isTransfer && !transaction.transferMatchId).length;
  elements.transferSummary.innerHTML = `
    <article class="transfer-card">
      <strong>${matchedTransfers}</strong>
      <span>matched transfer pair${matchedTransfers === 1 ? "" : "s"}</span>
    </article>
    <article class="transfer-card">
      <strong>${unmatchedTransfers}</strong>
      <span>unmatched transfer row${unmatchedTransfers === 1 ? "" : "s"}</span>
    </article>
  `;
}

function renderTransactions(visibleTransactions) {
  elements.transactionsBody.innerHTML = "";
  if (!visibleTransactions.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8">No transactions match the current filters yet.</td>`;
    elements.transactionsBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleTransactions.forEach((transaction) => {
    const row = document.createElement("tr");
    row.appendChild(buildCell(formatDate(transaction.date)));
    row.appendChild(buildCell(transaction.description));
    row.appendChild(buildCell(transaction.merchant || transaction.rawMerchant || transaction.description));
    row.appendChild(buildCell(transaction.institution));
    row.appendChild(buildCell(transaction.account || "Unlabeled"));

    const categoryCell = document.createElement("td");
    const categorySelect = document.createElement("select");
    categorySelect.className = "category-select";
    defaultCategories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = category === transaction.category;
      categorySelect.appendChild(option);
    });
    categorySelect.addEventListener("change", (event) => {
      clearTransactionSplits(transaction);
      applyLearnedCategory(transaction, event.target.value);
      refreshDerivedState();
      saveData();
      render();
    });
    if (transaction.splits?.length) {
      categorySelect.disabled = true;
    }
    categoryCell.appendChild(categorySelect);
    row.appendChild(categoryCell);

    row.appendChild(buildFlagCell(transaction));

    const amountCell = buildCell(formatCurrency(transaction.amount), "amount-cell");
    amountCell.classList.add(transaction.amount >= 0 ? "positive" : "negative");
    row.appendChild(amountCell);
    fragment.appendChild(row);
  });
  elements.transactionsBody.appendChild(fragment);
}

function buildFlagLabel(transaction) {
  const flags = [];
  if (transaction.isTransfer) {
    flags.push(transaction.transferMatchId ? "Matched transfer" : "Transfer");
  }
  if (transaction.recurringKey) {
    flags.push("Recurring");
  }
  if (transaction.splits?.length) {
    flags.push("Split");
  }
  return flags.join(" · ") || "Purchase";
}

function buildFlagCell(transaction) {
  const cell = document.createElement("td");
  cell.className = "flag-cell";
  const text = document.createElement("div");
  text.textContent = buildFlagLabel(transaction);
  cell.appendChild(text);

  const splitButton = document.createElement("button");
  splitButton.className = "ghost-button small-button";
  splitButton.type = "button";
  splitButton.textContent = transaction.splits?.length ? "Edit split" : "Split";
  splitButton.addEventListener("click", () => {
    editTransactionSplit(transaction);
  });
  cell.appendChild(splitButton);
  return cell;
}

function buildCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
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

function isMoneyMovement(transaction) {
  return transaction.isTransfer;
}

function hydrateTransaction(transaction) {
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

function buildSearchText(transaction) {
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

function getImportPreset(headers) {
  return state.importPresets[buildHeaderSignature(headers)] || null;
}

function saveImportPreset(headers, mapping) {
  state.importPresets[buildHeaderSignature(headers)] = mapping;
}

function buildHeaderSignature(headers) {
  return headers.map((header) => header.trim().toLowerCase()).join("|");
}

function applyLearnedCategory(sourceTransaction, category) {
  const merchantKey = sourceTransaction.merchantKey;
  if (!merchantKey) {
    sourceTransaction.category = category;
    return;
  }

  state.merchantRules[merchantKey] = category;
  state.transactions.forEach((transaction) => {
    if (transaction.merchantKey === merchantKey) {
      transaction.category = category;
    }
  });
}

function rerunCategories() {
  if (!state.transactions.length) {
    window.alert("There are no transactions to recategorize yet.");
    return;
  }
  state.transactions = state.transactions.map((transaction) =>
    hydrateTransaction({
      ...transaction,
      category: inferCategory(transaction.merchant || transaction.description, transaction.amount),
      splits: recategorizeSplits(transaction),
    }),
  );
  refreshDerivedState();
  saveData();
  render();
  window.alert("Re-ran category rules across all transactions.");
}

function recategorizeSplits(transaction) {
  if (!transaction.splits?.length) {
    return transaction.splits || [];
  }

  return transaction.splits.map((split) => ({
    ...split,
    category: split.category || inferCategory(transaction.merchant || transaction.description, split.amount),
  }));
}

function matchTransfers(transactions) {
  transactions.forEach((transaction) => {
    transaction.transferMatchId = "";
    transaction.isTransfer = transaction.category === "Transfer" || isTransferLikeText(transaction.description) || isTransferLikeText(transaction.merchant);
  });

  const transfers = transactions.filter((transaction) => transaction.isTransfer).slice().sort((left, right) => left.date.localeCompare(right.date));
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

function detectRecurringSeries(transactions) {
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

function buildMonthlySeries(transactions) {
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

function buildAccountStats(transactions) {
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

function guessColumn(headers, pattern) {
  return headers.find((header) => pattern.test(header)) || "";
}

function formatCurrency(value) {
  return currencyFormatter.format(value);
}

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return monthFormatter.format(new Date(Number(year), Number(month) - 1, 1));
}

function exportFilteredTransactions() {
  const visibleTransactions = getFilteredTransactions({ search: true });
  if (!visibleTransactions.length) {
    window.alert("There are no filtered transactions to export.");
    return;
  }

  const rows = [
    ["Date", "Description", "Merchant", "Institution", "Account", "Category", "Flags", "Amount"],
    ...visibleTransactions.map((transaction) => [
      transaction.date,
      transaction.description,
      transaction.merchant,
      transaction.institution,
      transaction.account,
      transaction.category,
      buildFlagLabel(transaction),
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
      state.monthFilter = "all";
      state.searchQuery = "";
      state.parsedImport = null;
      elements.searchInput.value = "";
      refreshDerivedState();
      saveData();
      render();
      window.alert("Ledger file loaded successfully.");
    } catch (error) {
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
    renderRules();
  }
}

function matchRuleCategory(merchant) {
  const normalized = normalizeMerchantKey(merchant);
  const rule = state.rules.find((current) => normalized.includes(current.pattern));
  return rule ? rule.category : "";
}

function isLikelyDuplicate(candidate, existingTransactions) {
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

function getCategoryBreakdown(transaction) {
  if (transaction.splits?.length) {
    return transaction.splits;
  }
  return [{ category: transaction.category, amount: transaction.amount }];
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

function clearTransactionSplits(transaction) {
  transaction.splits = [];
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}
