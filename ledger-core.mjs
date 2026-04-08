export function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header, index) => (header?.trim() ? header.trim() : `Column ${index + 1}`));
  const normalizedRows = dataRows
    .map((currentRow) => {
      const normalized = {};
      headers.forEach((header, index) => {
        normalized[header] = currentRow[index] ? currentRow[index].trim() : "";
      });
      return normalized;
    })
    .filter((currentRow) => Object.values(currentRow).some(Boolean));

  return { headers, rows: normalizedRows };
}

export function parseAmountDetails(value) {
  if (value === undefined || value === null) {
    return { value: null, direction: null };
  }
  const raw = String(value).trim();
  const direction = inferDirectionFromText(raw);
  const normalized = raw.replace(/[$,\s]/g, "").replace(/[()]/g, "").replace(/cr|dr/gi, "");
  if (!normalized) {
    return { value: 0, direction };
  }
  const isNegative = raw.includes("(") || normalized.startsWith("-");
  const numeric = Number.parseFloat(normalized);
  if (Number.isNaN(numeric)) {
    return { value: null, direction };
  }
  return { value: isNegative ? -Math.abs(numeric) : numeric, direction };
}

export function parseCurrency(value) {
  return parseAmountDetails(value).value;
}

export function inferDirectionFromText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (/\b(cr|credit|deposit|inflow)\b/.test(text)) {
    return "credit";
  }
  if (/\b(dr|debit|withdrawal|outflow|charge)\b/.test(text)) {
    return "debit";
  }
  return null;
}

export function applyDirectionToAmount(value, direction) {
  if (value === null) {
    return null;
  }
  if (direction === "credit") {
    return Math.abs(value);
  }
  if (direction === "debit") {
    return -Math.abs(value);
  }
  return value;
}

export function resolveAmount(row, mapping) {
  if (mapping.amount) {
    const parsedAmount = parseAmountDetails(row[mapping.amount]);
    if (parsedAmount.value === null) {
      return null;
    }
    if (mapping.type) {
      return applyDirectionToAmount(parsedAmount.value, inferDirectionFromText(row[mapping.type]));
    }
    if (mapping.amountMode === "credit-debit-text") {
      return applyDirectionToAmount(parsedAmount.value, parsedAmount.direction);
    }
    return mapping.amountMode === "expense-positive" ? -parsedAmount.value : parsedAmount.value;
  }

  const debit = mapping.debit ? parseCurrency(row[mapping.debit]) : 0;
  const credit = mapping.credit ? parseCurrency(row[mapping.credit]) : 0;
  if (!debit && !credit) {
    return null;
  }
  if (debit && credit) {
    return credit - debit;
  }
  if (debit) {
    return -Math.abs(debit);
  }
  return Math.abs(credit);
}

export function normalizeDate(value) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const match = String(value).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) {
    return null;
  }
  const [, month, day, year] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeMerchantLabel(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  return text
    .replace(/[*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildMerchantKey({ merchant, rawMerchant, description }) {
  const source = rawMerchant || merchant || description;
  return normalizeMerchantKey(source);
}

export function normalizeMerchantKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\d+\b/g, " ")
    .replace(/[*#./-]/g, " ")
    .replace(/\b(inc|llc|corp|co|store|restaurant|market|payment|purchase|debit|credit)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAmountMode(rows, amountColumn) {
  if (!amountColumn) {
    return "signed";
  }
  let creditDebitTextCount = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let refundLikeNegativeCount = 0;

  rows.slice(0, 25).forEach((row) => {
    const parsed = parseAmountDetails(row[amountColumn]);
    if (parsed.direction) {
      creditDebitTextCount += 1;
    }
    if (parsed.value > 0) {
      positiveCount += 1;
    } else if (parsed.value < 0) {
      negativeCount += 1;
      if (/payment|refund|credit|reversal/.test(Object.values(row).join(" ").toLowerCase())) {
        refundLikeNegativeCount += 1;
      }
    }
  });

  if (creditDebitTextCount > 0) {
    return "credit-debit-text";
  }
  if (positiveCount >= negativeCount * 2 && refundLikeNegativeCount > 0) {
    return "expense-positive";
  }
  return "signed";
}

export function parseSplitInput(input, transactionAmount) {
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return null;
  }

  const splits = [];
  for (const part of parts) {
    const [categoryPart, amountPart] = part.split(":").map((value) => value?.trim());
    if (!categoryPart || !amountPart) {
      return null;
    }
    const amount = Number.parseFloat(amountPart);
    if (Number.isNaN(amount) || amount <= 0) {
      return null;
    }
    splits.push({
      category: categoryPart,
      amount: transactionAmount < 0 ? -Math.abs(amount) : Math.abs(amount),
    });
  }

  const total = splits.reduce((sum, split) => sum + split.amount, 0);
  if (Math.abs(total - transactionAmount) > 0.02) {
    return null;
  }
  return splits;
}

export function daysBetween(leftDate, rightDate) {
  const left = new Date(`${leftDate}T12:00:00`);
  const right = new Date(`${rightDate}T12:00:00`);
  return Math.round((right - left) / 86400000);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

