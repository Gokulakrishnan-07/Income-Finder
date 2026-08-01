/* ============================================================
   export.js — Excel (.xlsx) export via SheetJS
   ============================================================ */
const ScrapExport = (() => {
  function toRows(records, categories) {
    const catMap = Object.fromEntries(categories.map(c => [c.value, c.label]));
    return records
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        Date: r.date,
        Category: catMap[r.category] || r.category,
        "Amount (₹)": Number(r.amount),
        Notes: r.notes || ""
      }));
  }

  function download(records, categories, filename) {
    const rows = toRows(records, categories);
    const total = rows.reduce((s, r) => s + r["Amount (₹)"], 0);
    rows.push({ Date: "", Category: "TOTAL", "Amount (₹)": total, Notes: "" });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 34 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Income");
    XLSX.writeFile(wb, filename);
  }

  function exportCurrentMonth(all, categories) {
    const ym = new Date().toISOString().slice(0, 7);
    const rows = all.filter(r => r.date.startsWith(ym));
    download(rows, categories, `scrap-income-${ym}.xlsx`);
    return rows.length;
  }

  function exportMonth(all, categories, ym) {
    const rows = all.filter(r => r.date.startsWith(ym));
    download(rows, categories, `scrap-income-${ym}.xlsx`);
    return rows.length;
  }

  function exportAll(all, categories) {
    download(all, categories, `scrap-income-all.xlsx`);
    return all.length;
  }

  return { exportCurrentMonth, exportMonth, exportAll };
})();
