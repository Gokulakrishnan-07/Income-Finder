/* ============================================================
   app.js — Scrap Ledger main application logic
   ============================================================ */
(function () {
  "use strict";

  const CATEGORIES = [
    { value: "kottangushi", label: "கொட்டாங்குச்சி", icon: "bi-tree", color: "#B4862B" },
    { value: "puliyankottai", label: "புளியங்கொட்டை", icon: "bi-flower1", color: "#4C6B57" },
    { value: "irumbu_plastic", label: "இரும்பு / பிளாஸ்டிக்", icon: "bi-gear-wide-connected", color: "#B24A2A" }
  ];
  const catByValue = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

  let RECORDS = [];        // full cache from DB
  let sortAsc = false;     // date sort direction (default newest first)
  let pendingDeleteId = null;

  const fmtMoney = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const monthKey = (iso) => iso.slice(0, 7);
  const monthLabelFull = (ym) => {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };

  // ---------------- INIT ----------------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    populateCategorySelects();
    bindNav();
    bindForm();
    bindHistoryControls();
    bindExport();
    bindModal();
    bindReportsControl();

    const statusEl = document.getElementById("dbStatus");
    try {
      const { usingFallback } = await ScrapDB.init();
      statusEl.innerHTML = usingFallback
        ? '<i class="bi bi-hdd"></i> <span>Local storage</span>'
        : '<i class="bi bi-hdd-stack-fill"></i> <span>IndexedDB ready</span>';
    } catch {
      statusEl.innerHTML = '<i class="bi bi-exclamation-triangle"></i> <span>Storage error</span>';
    }

    document.getElementById("fDate").value = todayISO();
    await reload();
  }

  async function reload() {
    RECORDS = await ScrapDB.getAll();
    renderDashboard();
    renderHistory();
    populateMonthSelects();
    renderReports();
  }

  // ---------------- NAV ----------------
  function bindNav() {
    document.querySelectorAll(".navlink").forEach(btn => {
      btn.addEventListener("click", () => showView(btn.dataset.view));
    });
    document.querySelectorAll("[data-view-link]").forEach(btn => {
      btn.addEventListener("click", () => showView(btn.dataset.viewLink));
    });
    const menuToggle = document.getElementById("menuToggle");
    const sidenav = document.getElementById("sidenav");
    const scrim = document.getElementById("scrim");
    menuToggle.addEventListener("click", () => {
      sidenav.classList.add("open");
      scrim.classList.add("show");
    });
    scrim.addEventListener("click", closeMobileNav);
  }
  function closeMobileNav() {
    document.getElementById("sidenav").classList.remove("open");
    document.getElementById("scrim").classList.remove("show");
  }
  function showView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + name).classList.add("active");
    document.querySelectorAll(".navlink").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    closeMobileNav();
    if (name === "reports") renderReports();
  }

  // ---------------- CATEGORY SELECTS ----------------
  function populateCategorySelects() {
    const selectors = ["#fCategory", "#filterCategory"];
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      CATEGORIES.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.value;
        opt.textContent = c.label;
        el.appendChild(opt);
      });
    });
  }

  function populateMonthSelects() {
    const months = Array.from(new Set(RECORDS.map(r => monthKey(r.date)))).sort().reverse();
    const currentYm = todayISO().slice(0, 7);
    if (!months.includes(currentYm)) months.unshift(currentYm);

    const targets = ["#filterMonth", "#reportMonth", "#exportMonthSelect"];
    targets.forEach(sel => {
      const el = document.querySelector(sel);
      const keepFirst = sel === "#filterMonth"; // "All months" option
      const prevValue = el.value;
      el.innerHTML = "";
      if (keepFirst) {
        const optAll = document.createElement("option");
        optAll.value = ""; optAll.textContent = "All months";
        el.appendChild(optAll);
      }
      months.forEach(ym => {
        const opt = document.createElement("option");
        opt.value = ym; opt.textContent = monthLabelFull(ym);
        el.appendChild(opt);
      });
      if (prevValue && [...el.options].some(o => o.value === prevValue)) el.value = prevValue;
      else if (!keepFirst) el.value = currentYm;
    });
  }

  // ---------------- DASHBOARD ----------------
  function renderDashboard() {
    const total = RECORDS.reduce((s, r) => s + Number(r.amount), 0);
    document.getElementById("totalIncome").textContent = total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById("totalEntries").textContent = RECORDS.length;

    const grid = document.getElementById("categoryCards");
    grid.innerHTML = CATEGORIES.map((c, i) => {
      const rows = RECORDS.filter(r => r.category === c.value);
      const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
      const tilt = i % 2 === 0 ? "-0.6deg" : "0.7deg";
      return `<div class="tag-card" style="--tilt:${tilt}">
        <div class="tag-icon" style="background:${c.color}"><i class="bi ${c.icon}"></i></div>
        <span class="tag-name">${c.label}</span>
        <span class="tag-amount">${fmtMoney(sum)}</span>
        <span class="tag-count">${rows.length} ${rows.length === 1 ? "entry" : "entries"}</span>
      </div>`;
    }).join("");

    // recent entries (last 6)
    const recent = RECORDS.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6);
    const tbody = document.querySelector("#recentTable tbody");
    tbody.innerHTML = recent.map(rowHtml).join("");
    document.getElementById("recentEmpty").hidden = recent.length !== 0;
    document.getElementById("recentTable").style.display = recent.length ? "" : "none";

    ScrapCharts.renderMonthly(document.getElementById("chartMonthly"), RECORDS);
    ScrapCharts.renderCategoryPie(document.getElementById("chartCategoryPie"), RECORDS, CATEGORIES);
  }

  function rowHtml(r, withActions) {
    const c = catByValue[r.category] || { label: r.category, color: "#999" };
    const notes = r.notes ? escapeHtml(r.notes) : '<span style="opacity:.5">—</span>';
    const actions = withActions ? `<td class="text-end">
        <button class="icon-btn" data-edit="${r.id}" title="Edit"><i class="bi bi-pencil"></i></button>
        <button class="icon-btn danger" data-delete="${r.id}" title="Delete"><i class="bi bi-trash3"></i></button>
      </td>` : "";
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td><span class="cat-pill" style="background:${c.color}22;color:${c.color}">${c.label}</span></td>
      <td class="text-end">${fmtMoney(r.amount)}</td>
      <td>${notes}</td>
      ${actions}
    </tr>`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  // ---------------- FORM (ADD / EDIT) ----------------
  function bindForm() {
    const form = document.getElementById("incomeForm");
    form.addEventListener("submit", onSubmitForm);
    document.getElementById("clearBtn").addEventListener("click", resetForm);
  }

  function validateForm() {
    let ok = true;
    const date = document.getElementById("fDate").value;
    const category = document.getElementById("fCategory").value;
    const amount = document.getElementById("fAmount").value;

    document.getElementById("err-fDate").textContent = "";
    document.getElementById("err-fCategory").textContent = "";
    document.getElementById("err-fAmount").textContent = "";

    if (!date) { document.getElementById("err-fDate").textContent = "Date is required."; ok = false; }
    if (!category) { document.getElementById("err-fCategory").textContent = "Please choose a category."; ok = false; }
    if (!amount || Number(amount) <= 0) { document.getElementById("err-fAmount").textContent = "Amount must be greater than zero."; ok = false; }
    return ok;
  }

  async function onSubmitForm(e) {
    e.preventDefault();
    if (!validateForm()) return;

    const editId = document.getElementById("editId").value;
    const record = {
      date: document.getElementById("fDate").value,
      category: document.getElementById("fCategory").value,
      amount: Number(document.getElementById("fAmount").value),
      notes: document.getElementById("fNotes").value.trim(),
      createdAt: new Date().toISOString()
    };

    try {
      if (editId) {
        record.id = Number(editId);
        await ScrapDB.update(record);
        showToast("formToast", "Entry updated.");
      } else {
        await ScrapDB.add(record);
        showToast("formToast", "Entry saved to the ledger.");
      }
      resetForm();
      await reload();
    } catch (err) {
      showToast("formToast", "Couldn't save — please try again.", true);
    }
  }

  function resetForm() {
    document.getElementById("incomeForm").reset();
    document.getElementById("editId").value = "";
    document.getElementById("fDate").value = todayISO();
    document.getElementById("submitBtn").innerHTML = '<i class="bi bi-check2-circle"></i> Save Entry';
    ["err-fDate", "err-fCategory", "err-fAmount"].forEach(id => document.getElementById(id).textContent = "");
  }

  function showToast(elId, msg, isError) {
    const el = document.getElementById(elId);
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("is-error", !!isError);
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function startEdit(id) {
    const r = RECORDS.find(x => x.id === id);
    if (!r) return;
    document.getElementById("editId").value = r.id;
    document.getElementById("fDate").value = r.date;
    document.getElementById("fCategory").value = r.category;
    document.getElementById("fAmount").value = r.amount;
    document.getElementById("fNotes").value = r.notes || "";
    document.getElementById("submitBtn").innerHTML = '<i class="bi bi-check2-circle"></i> Update Entry';
    showView("add");
  }

  // ---------------- HISTORY ----------------
  function bindHistoryControls() {
    document.getElementById("searchInput").addEventListener("input", renderHistory);
    document.getElementById("filterMonth").addEventListener("change", renderHistory);
    document.getElementById("filterCategory").addEventListener("change", renderHistory);
    document.getElementById("sortBtn").addEventListener("click", () => {
      sortAsc = !sortAsc;
      document.getElementById("sortIcon").className = sortAsc ? "bi bi-sort-up" : "bi bi-sort-down";
      renderHistory();
    });

    document.querySelector("#historyTable tbody").addEventListener("click", (e) => {
      const editId = e.target.closest("[data-edit]")?.dataset.edit;
      const delId = e.target.closest("[data-delete]")?.dataset.delete;
      if (editId) startEdit(Number(editId));
      if (delId) openDeleteModal(Number(delId));
    });
    document.querySelector("#recentTable tbody").addEventListener("click", (e) => {
      // recent table has no actions, but keep for future-proofing
    });
  }

  function renderHistory() {
    const q = document.getElementById("searchInput").value.trim().toLowerCase();
    const month = document.getElementById("filterMonth").value;
    const cat = document.getElementById("filterCategory").value;

    let rows = RECORDS.slice();
    if (month) rows = rows.filter(r => monthKey(r.date) === month);
    if (cat) rows = rows.filter(r => r.category === cat);
    if (q) {
      rows = rows.filter(r => {
        const label = (catByValue[r.category]?.label || "").toLowerCase();
        return label.includes(q) || (r.notes || "").toLowerCase().includes(q);
      });
    }
    rows.sort((a, b) => sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));

    const tbody = document.querySelector("#historyTable tbody");
    tbody.innerHTML = rows.map(r => rowHtml(r, true)).join("");
    document.getElementById("historyEmpty").hidden = rows.length !== 0;
    document.getElementById("historyTable").style.display = rows.length ? "" : "none";
  }

  // ---------------- DELETE MODAL ----------------
  function bindModal() {
    document.getElementById("cancelDelete").addEventListener("click", closeDeleteModal);
    document.getElementById("confirmDelete").addEventListener("click", async () => {
      if (pendingDeleteId != null) {
        await ScrapDB.remove(pendingDeleteId);
        await reload();
      }
      closeDeleteModal();
    });
  }
  function openDeleteModal(id) {
    pendingDeleteId = id;
    document.getElementById("confirmModal").hidden = false;
  }
  function closeDeleteModal() {
    pendingDeleteId = null;
    document.getElementById("confirmModal").hidden = true;
  }

  // ---------------- REPORTS ----------------
  function bindReportsControl() {
    document.getElementById("reportMonth").addEventListener("change", renderReports);
  }

  function renderReports() {
    const ym = document.getElementById("reportMonth").value || todayISO().slice(0, 7);
    const rows = RECORDS.filter(r => monthKey(r.date) === ym);
    const amounts = rows.map(r => Number(r.amount));
    const total = amounts.reduce((a, b) => a + b, 0);
    const count = rows.length;
    const highest = count ? Math.max(...amounts) : 0;
    const lowest = count ? Math.min(...amounts) : 0;
    const avg = count ? total / count : 0;

    document.getElementById("reportStats").innerHTML = `
      <div class="stat-card accent"><div class="stat-label">Monthly Total</div><div class="stat-value">${fmtMoney(total)}</div></div>
      <div class="stat-card"><div class="stat-label">Entries</div><div class="stat-value">${count}</div></div>
      <div class="stat-card"><div class="stat-label">Highest Income</div><div class="stat-value">${fmtMoney(highest)}</div></div>
      <div class="stat-card"><div class="stat-label">Lowest Income</div><div class="stat-value">${count ? fmtMoney(lowest) : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Average Income</div><div class="stat-value">${fmtMoney(avg)}</div></div>
    `;

    const tbody = document.querySelector("#reportCategoryTable tbody");
    tbody.innerHTML = CATEGORIES.map(c => {
      const catRows = rows.filter(r => r.category === c.value);
      const sum = catRows.reduce((s, r) => s + Number(r.amount), 0);
      return `<tr><td><span class="cat-pill" style="background:${c.color}22;color:${c.color}">${c.label}</span></td>
        <td class="text-end">${fmtMoney(sum)}</td><td class="text-end">${catRows.length}</td></tr>`;
    }).join("");

    ScrapCharts.renderComparison(document.getElementById("chartComparison"), RECORDS);
  }

  // ---------------- EXPORT ----------------
  function bindExport() {
    document.getElementById("exportCurrentBtn").addEventListener("click", () => {
      const n = ScrapExport.exportCurrentMonth(RECORDS, CATEGORIES);
      showToast("exportToast", n ? `Exported ${n} entries.` : "No entries this month yet.");
    });
    document.getElementById("exportSelectedBtn").addEventListener("click", () => {
      const ym = document.getElementById("exportMonthSelect").value;
      const n = ScrapExport.exportMonth(RECORDS, CATEGORIES, ym);
      showToast("exportToast", n ? `Exported ${n} entries for ${monthLabelFull(ym)}.` : "No entries for that month.");
    });
    document.getElementById("exportAllBtn").addEventListener("click", () => {
      const n = ScrapExport.exportAll(RECORDS, CATEGORIES);
      showToast("exportToast", n ? `Exported all ${n} entries.` : "No entries to export yet.");
    });
  }

})();
