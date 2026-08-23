/* Excel import helpers. Uses the existing SheetJS/XLSX browser build. */
const ScrapImport = (() => {
  const allowedExtensions = ["xlsx", "xls", "csv"];

  function normalize(value) {
    return String(value ?? "").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  }

  function headerField(value) {
    const key = normalize(value);
    if (["date", "incomeDate", "transactionDate"].map(normalize).includes(key)) return "date";
    if (["category", "categoryName", "type", "material"].map(normalize).includes(key)) return "category";
    if (["amount", "income", "total", "value", "amountInr"].map(normalize).includes(key)) return "amount";
    if (["notes", "note", "description", "details", "remarks", "comment"].map(normalize).includes(key)) return "notes";
    return "";
  }

  function dateToISO(value, date1904) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = XLSX.SSF.parse_date_code(value, { date1904 });
      if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
    const text = String(value ?? "").trim();
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return validISO(match[1], match[2], match[3]);
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return validISO(match[3], match[2], match[1]);
    return "";
  }

  function validISO(year, month, day) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00`);
    return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) ? iso : "";
  }

  function parseAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
    const parsed = Number(String(value ?? "").replace(/[₹,$\s]/g, ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function resolveCategory(value, categories) {
    const wanted = normalize(value);
    const direct = categories.find(category => normalize(category.value) === wanted || normalize(category.label) === wanted);
    if (direct) return direct;
    const legacyMetal = ["pithalai", "chembu", "aluminium", "பித்தளை", "செம்பு", "அலுமினியம்", "brass", "copper", "aluminum"].map(normalize);
    return legacyMetal.includes(wanted) ? categories.find(category => category.value === "metal") : undefined;
  }

  function fingerprint(record) {
    return [record.date, record.category, Number(record.amount).toFixed(2), normalize(record.notes)].join("|");
  }

  async function readFile(file, categories, existingRecords) {
    if (typeof XLSX === "undefined") throw new Error("Unable to import this file. The spreadsheet reader is unavailable.");
    const extension = String(file.name || "").split(".").pop().toLocaleLowerCase();
    if (!allowedExtensions.includes(extension)) throw new Error("Please choose an .xlsx, .xls, or .csv file.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.SheetNames?.[0];
    if (!firstSheet) throw new Error("The Excel file does not contain a worksheet.");
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: "", blankrows: false });
    const headerIndex = rows.slice(0, 10).findIndex(row => {
      const fields = row.map(headerField).filter(Boolean);
      return fields.includes("date") && fields.includes("category") && fields.includes("amount");
    });
    if (headerIndex < 0) throw new Error("Required columns not found. Include Date, Category, and Amount.");

    const headers = rows[headerIndex].map(headerField);
    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    const known = new Set(existingRecords.map(fingerprint));
    const imported = [];
    const errors = [];
    rows.slice(headerIndex + 1).forEach((row, offset) => {
      if (row.every(value => String(value ?? "").trim() === "")) return;
      const rowNumber = headerIndex + offset + 2;
      const raw = {};
      headers.forEach((field, index) => { if (field && raw[field] === undefined) raw[field] = row[index]; });
      const date = dateToISO(raw.date, date1904);
      const category = resolveCategory(raw.category, categories);
      const amount = parseAmount(raw.amount);
      const notes = String(raw.notes ?? "").trim().slice(0, 200);
      const rowErrors = [];
      if (!date) rowErrors.push("invalid date");
      if (!category) rowErrors.push("unknown category");
      if (!amount) rowErrors.push("amount must be greater than zero");
      const record = { date, category: category?.value, amount, notes, createdAt: new Date().toISOString() };
      if (!rowErrors.length && known.has(fingerprint(record))) rowErrors.push("duplicate record");
      if (rowErrors.length) errors.push({ row: rowNumber, message: rowErrors.join(", ") });
      else { known.add(fingerprint(record)); imported.push(record); }
    });
    return { records: imported, errors };
  }

  return { readFile };
})();
