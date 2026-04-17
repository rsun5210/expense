export function createCurrencyFormatter() {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
}

export function createDateFormatter() {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function createMonthFormatter() {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
}

export function formatCurrency(value, currencyFormatter) {
  return currencyFormatter.format(value);
}

export function formatDate(value, dateFormatter) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

export function formatMonth(value, monthFormatter) {
  const [year, month] = value.split("-");
  return monthFormatter.format(new Date(Number(year), Number(month) - 1, 1));
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  return cell;
}

export function buildFlagLabel(transaction) {
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

function buildFlagCell(transaction, onEditSplit) {
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
    onEditSplit(transaction);
  });
  cell.appendChild(splitButton);
  return cell;
}

export function renderMonthFilter({ state, elements, formatMonthLabel }) {
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
    option.textContent = formatMonthLabel(month);
    option.selected = month === currentValue;
    elements.monthFilter.appendChild(option);
  });
}

export function renderMetrics({ state, elements, visibleTransactions, isMoneyMovement, formatCurrencyValue, formatMonthLabel }) {
  const spending = visibleTransactions.filter((item) => item.amount < 0 && !isMoneyMovement(item)).reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const income = visibleTransactions.filter((item) => item.amount > 0 && !isMoneyMovement(item)).reduce((sum, item) => sum + item.amount, 0);
  const activeMonth =
    state.monthFilter === "all"
      ? visibleTransactions[0]?.date
        ? formatMonthLabel(visibleTransactions[0].date.slice(0, 7))
        : "All data"
      : formatMonthLabel(state.monthFilter);

  elements.metricSpending.textContent = formatCurrencyValue(spending);
  elements.metricIncome.textContent = formatCurrencyValue(income);
  elements.metricCount.textContent = String(visibleTransactions.length);
  elements.metricMonth.textContent = activeMonth;
}

export function renderTrends({ elements, months, formatCurrencyValue, formatMonthLabel }) {
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
        <strong>${formatMonthLabel(month.month)}</strong>
        <span>Net ${formatCurrencyValue(month.income - month.spending)}</span>
      </div>
      <div class="trend-bars">
        <div class="trend-bar-row">
          <span>Spend</span>
          <div class="trend-bar-shell"><div class="trend-bar spend" style="width:${(month.spending / maxValue) * 100}%"></div></div>
          <strong>${formatCurrencyValue(month.spending)}</strong>
        </div>
        <div class="trend-bar-row">
          <span>Income</span>
          <div class="trend-bar-shell"><div class="trend-bar income" style="width:${(month.income / maxValue) * 100}%"></div></div>
          <strong>${formatCurrencyValue(month.income)}</strong>
        </div>
      </div>
    `;
    fragment.appendChild(card);
  });

  elements.trendsChart.appendChild(fragment);
}

export function renderSummary({ elements, transactions, isMoneyMovement, getCategoryBreakdown, formatCurrencyValue }) {
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
      node.querySelector(".summary-amount").textContent = formatCurrencyValue(stats.amount);
      fragment.appendChild(node);
    });
  elements.summaryList.appendChild(fragment);
}

export function renderReviewSummary({ elements, summary, formatCurrencyValue, onSelectFilter }) {
  elements.reviewSummary.innerHTML = "";
  if (!summary.totalCount) {
    elements.reviewSummary.innerHTML = `<div class="empty-state">Import transactions to build a review queue.</div>`;
    return;
  }

  const cards = [
    { label: "Needs review", amount: String(summary.pendingCount), detail: `${summary.reviewedCount} already reviewed`, filter: "needs-review" },
    { label: "Pending outflows", amount: formatCurrencyValue(summary.pendingOutflows), detail: `${summary.pendingCount} transactions still to review`, filter: "needs-review" },
    { label: "Review rate", amount: `${Math.round(summary.reviewedRate)}%`, detail: `${summary.reviewedCount} of ${summary.totalCount} reviewed`, filter: "all" },
  ];

  const fragment = document.createDocumentFragment();
  cards.forEach((cardData) => {
    const card = document.createElement("button");
    card.className = "mini-card review-card";
    card.type = "button";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(cardData.label)}</strong>
        <p>${escapeHtml(cardData.detail)}</p>
      </div>
      <div class="mini-card-value">
        <strong>${escapeHtml(cardData.amount)}</strong>
      </div>
    `;
    card.addEventListener("click", () => onSelectFilter(cardData.filter));
    fragment.appendChild(card);
  });
  elements.reviewSummary.appendChild(fragment);
}

export function renderMerchantInsights({ elements, merchantRows, formatCurrencyValue }) {
  elements.merchantInsightsList.innerHTML = "";
  if (!merchantRows.length) {
    elements.merchantInsightsEmpty.hidden = false;
    return;
  }

  elements.merchantInsightsEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  merchantRows.forEach((merchant) => {
    const item = document.createElement("article");
    item.className = "mini-card";
    const trendLabel =
      merchant.previousAmount > 0
        ? `${merchant.changeAmount >= 0 ? "+" : "-"}${formatCurrencyValue(Math.abs(merchant.changeAmount))} vs last month`
        : "New this month";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(merchant.merchant)}</strong>
        <p>${merchant.count} transaction${merchant.count === 1 ? "" : "s"} · ${escapeHtml(trendLabel)}</p>
      </div>
      <div class="mini-card-value">
        <strong>${formatCurrencyValue(merchant.amount)}</strong>
        <span>${merchant.previousAmount > 0 ? `${Math.round(merchant.changePercent)}% change` : "No previous month baseline"}</span>
      </div>
    `;
    fragment.appendChild(item);
  });
  elements.merchantInsightsList.appendChild(fragment);
}

export function renderRules({ elements, rules, onRemoveRule }) {
  elements.rulesList.innerHTML = "";
  if (!rules.length) {
    elements.rulesEmpty.hidden = false;
    return;
  }

  elements.rulesEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  rules.forEach((rule) => {
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
    button.addEventListener("click", () => onRemoveRule(rule));
    row.appendChild(button);
    fragment.appendChild(row);
  });
  elements.rulesList.appendChild(fragment);
}

export function renderRecurring({ elements, recurringSeries, formatCurrencyValue }) {
  elements.recurringList.innerHTML = "";
  if (!recurringSeries.length) {
    elements.recurringEmpty.hidden = false;
    return;
  }

  elements.recurringEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  recurringSeries.forEach((series) => {
    const item = document.createElement("article");
    item.className = "mini-card";
    const dueLabel = series.nextExpectedDate ? `Likely due ${escapeHtml(series.nextExpectedDate)}` : series.frequencyLabel;
    const today = new Date();
    const nextDate = series.nextExpectedDate ? new Date(`${series.nextExpectedDate}T12:00:00`) : null;
    const daysUntil = nextDate ? Math.round((nextDate - today) / (1000 * 60 * 60 * 24)) : null;
    const urgencyLabel =
      daysUntil === null
        ? "Awaiting more history"
        : daysUntil < 0
          ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`
          : daysUntil === 0
            ? "Due today"
            : `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
    item.innerHTML = `
      <div>
        <strong>${series.label}</strong>
        <p>${series.count} charges across ${series.monthCount} months · ${dueLabel}</p>
      </div>
      <div class="mini-card-value">
        <strong>${formatCurrencyValue(series.averageAmount)}</strong>
        <span>${escapeHtml(urgencyLabel)}</span>
      </div>
    `;
    fragment.appendChild(item);
  });
  elements.recurringList.appendChild(fragment);
}

export function renderBudgets({
  elements,
  budgetMonth,
  budgetRows,
  budgetSummary,
  formatMonthLabel,
  formatCurrencyValue,
}) {
  const readyLabel = budgetSummary.readyToAssign >= 0 ? "Ready to assign" : "Overassigned";
  elements.budgetCaption.textContent = `${readyLabel} ${formatCurrencyValue(Math.abs(budgetSummary.readyToAssign))} · Assigned ${formatCurrencyValue(
    budgetSummary.assigned,
  )} · Available ${formatCurrencyValue(budgetSummary.available)}${budgetSummary.carried > 0 ? ` · Carryover ${formatCurrencyValue(budgetSummary.carried)}` : ""}`;
  elements.budgetList.innerHTML = "";

  if (!budgetRows.length) {
    elements.budgetEmpty.hidden = false;
    return;
  }

  elements.budgetEmpty.hidden = true;
  const fragment = document.createDocumentFragment();

  budgetRows.forEach((row) => {
    const card = document.createElement("article");
    card.className = "budget-card";
    const safePercent = Math.max(0, Math.min(row.percentUsed, 100));
    const statusClass = row.available < 0 ? "over" : "under";
    card.innerHTML = `
      <div class="budget-top">
        <div>
          <strong>${escapeHtml(row.category)}</strong>
          <p>${formatCurrencyValue(row.activity)} activity · ${formatCurrencyValue(row.carryover)} carryover · last month ${formatCurrencyValue(row.previousAssigned)}</p>
        </div>
        <span class="budget-remaining ${statusClass}">${row.available >= 0 ? "Available" : "Overspent"} ${formatCurrencyValue(Math.abs(row.available))}</span>
      </div>
      <div class="budget-stats">
        <div>
          <span>Assigned</span>
          <strong>${formatCurrencyValue(row.assigned)}</strong>
        </div>
        <div>
          <span>Activity</span>
          <strong>${formatCurrencyValue(row.activity)}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>${formatCurrencyValue(row.available)}</strong>
        </div>
      </div>
      <label class="budget-input-wrap">
        Assign this month
        <input class="budget-input" data-category="${escapeHtml(row.category)}" type="number" min="0" step="0.01" value="${row.assigned || ""}" placeholder="0.00" />
      </label>
      <div class="budget-bar-shell">
        <div class="budget-bar ${statusClass}" style="width:${safePercent}%"></div>
      </div>
      <p class="budget-underfunded ${row.underfunded > 0 ? "is-active" : ""}">${row.underfunded > 0 ? `Underfunded ${formatCurrencyValue(row.underfunded)}` : "Fully funded for this pattern"}</p>
    `;
    fragment.appendChild(card);
  });

  elements.budgetList.appendChild(fragment);
}

export function renderSpendingPlan({ elements, planCards, formatCurrencyValue }) {
  elements.planGrid.innerHTML = "";
  if (!planCards.length) {
    elements.planEmpty.hidden = false;
    return;
  }

  elements.planEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  planCards.forEach((cardData) => {
    const card = document.createElement("article");
    card.className = "mini-card plan-snapshot-card";
    card.innerHTML = `
      <p>${escapeHtml(cardData.label)}</p>
      <strong>${formatCurrencyValue(cardData.amount)}</strong>
      <span>${escapeHtml(cardData.detail)}</span>
    `;
    fragment.appendChild(card);
  });
  elements.planGrid.appendChild(fragment);
}

export function renderAccountsAndTransfers({ elements, transactions, accountStats, formatCurrencyValue }) {
  elements.accountList.innerHTML = "";
  elements.transferSummary.innerHTML = "";

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
          <strong>${formatCurrencyValue(account.spending)}</strong>
          <span>${account.institution}</span>
        </div>
      `;
      fragment.appendChild(item);
    });
    elements.accountList.appendChild(fragment);
  }

  const matchedTransfers = transactions.filter((transaction) => transaction.transferMatchId).length / 2;
  const unmatchedTransfers = transactions.filter((transaction) => transaction.isTransfer && !transaction.transferMatchId).length;
  elements.transferSummary.innerHTML = `
    <article class="transfer-card transfer-card-heading">
      <strong>Transfer matching</strong>
      <span>Money movement checks</span>
    </article>
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

export function renderTransactions({
  elements,
  visibleTransactions,
  defaultCategories,
  formatCurrencyValue,
  formatDateValue,
  onCategoryChange,
  onEditNote,
  onEditTags,
  onToggleReviewed,
  onEditSplit,
}) {
  elements.transactionsBody.innerHTML = "";
  if (!visibleTransactions.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="11">No transactions match the current filters yet.</td>`;
    elements.transactionsBody.appendChild(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleTransactions.forEach((transaction) => {
    const row = document.createElement("tr");
    row.appendChild(buildCell(formatDateValue(transaction.date)));
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
    categorySelect.addEventListener("change", (event) => onCategoryChange(transaction, event.target.value));
    if (transaction.splits?.length) {
      categorySelect.disabled = true;
    }
    categoryCell.appendChild(categorySelect);
    row.appendChild(categoryCell);

    row.appendChild(buildFlagCell(transaction, onEditSplit));

    const reviewCell = document.createElement("td");
    reviewCell.className = "review-cell";
    const reviewButton = document.createElement("button");
    reviewButton.className = transaction.reviewed ? "ghost-button small-button" : "primary-button small-button";
    reviewButton.type = "button";
    reviewButton.textContent = transaction.reviewed ? "Reviewed" : "Mark reviewed";
    reviewButton.addEventListener("click", () => onToggleReviewed(transaction));
    reviewCell.appendChild(reviewButton);
    row.appendChild(reviewCell);

    const noteCell = document.createElement("td");
    noteCell.className = "note-cell";
    const notePreview = document.createElement("div");
    notePreview.className = "note-preview";
    notePreview.textContent = transaction.note || "No note";
    noteCell.appendChild(notePreview);
    const noteButton = document.createElement("button");
    noteButton.className = "ghost-button small-button";
    noteButton.type = "button";
    noteButton.textContent = transaction.note ? "Edit note" : "Add note";
    noteButton.addEventListener("click", () => onEditNote(transaction));
    noteCell.appendChild(noteButton);
    row.appendChild(noteCell);

    const tagsCell = document.createElement("td");
    tagsCell.className = "tags-cell";
    const tagsPreview = document.createElement("div");
    tagsPreview.className = "tags-preview";
    tagsPreview.textContent = transaction.tags?.length ? transaction.tags.join(" · ") : "No tags";
    tagsCell.appendChild(tagsPreview);
    const tagsButton = document.createElement("button");
    tagsButton.className = "ghost-button small-button";
    tagsButton.type = "button";
    tagsButton.textContent = transaction.tags?.length ? "Edit tags" : "Add tags";
    tagsButton.addEventListener("click", () => onEditTags(transaction));
    tagsCell.appendChild(tagsButton);
    row.appendChild(tagsCell);

    const amountCell = buildCell(formatCurrencyValue(transaction.amount), "amount-cell");
    amountCell.classList.add(transaction.amount >= 0 ? "positive" : "negative");
    row.appendChild(amountCell);
    fragment.appendChild(row);
  });
  elements.transactionsBody.appendChild(fragment);
}

export function renderGoals({ elements, goalRows, formatCurrencyValue, onEditGoal, onRemoveGoal }) {
  elements.goalsList.innerHTML = "";
  if (!goalRows.length) {
    elements.goalsEmpty.hidden = false;
    return;
  }

  elements.goalsEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  goalRows.forEach((goal) => {
    const card = document.createElement("article");
    card.className = "goal-card";
    const safePercent = Math.max(0, Math.min(goal.progress, 100));
    card.innerHTML = `
      <div class="goal-top">
        <div>
          <strong>${escapeHtml(goal.name)}</strong>
          <p>${escapeHtml(goal.category)} available balance · target ${escapeHtml(goal.targetLabel)}</p>
        </div>
        <span>${formatCurrencyValue(goal.targetAmount)} target</span>
      </div>
      <div class="budget-bar-shell">
        <div class="budget-bar" style="width:${safePercent}%"></div>
      </div>
      <p class="goal-detail">${formatCurrencyValue(goal.saved)} available now · ${formatCurrencyValue(goal.remaining)} left to fully fund</p>
    `;
    const actionRow = document.createElement("div");
    actionRow.className = "goal-actions";
    const editButton = document.createElement("button");
    editButton.className = "ghost-button small-button";
    editButton.type = "button";
    editButton.textContent = "Edit goal";
    editButton.addEventListener("click", () => onEditGoal(goal));
    const removeButton = document.createElement("button");
    removeButton.className = "ghost-button small-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => onRemoveGoal(goal));
    actionRow.append(editButton, removeButton);
    card.appendChild(actionRow);
    fragment.appendChild(card);
  });
  elements.goalsList.appendChild(fragment);
}
