/* ============================================================
   charts.js — Chart.js instances for Scrap Ledger
   ============================================================ */
const ScrapCharts = (() => {
  let monthlyChart = null;
  let pieChart = null;
  let comparisonChart = null;

  const PALETTE = ["#2f8cff", "#5bd5ff", "#7b61ff", "#36d6a0", "#a879ff", "#6ca8ff"];

  function monthLabel(ym) {
    const [y, m] = ym.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }

  function buildMonthlyTotals(records) {
    const map = {};
    records.forEach(r => {
      const ym = r.date.slice(0, 7);
      map[ym] = (map[ym] || 0) + Number(r.amount);
    });
    const keys = Object.keys(map).sort();
    return { labels: keys.map(monthLabel), keys, values: keys.map(k => map[k]) };
  }

  function renderMonthly(canvasEl, records) {
    const { labels, values } = buildMonthlyTotals(records);
    const data = {
      labels,
      datasets: [{
        label: "Income",
        data: values,
        backgroundColor: "#2f8cff",
        borderRadius: 6,
        maxBarThickness: 42
      }]
    };
    if (monthlyChart) { monthlyChart.data = data; monthlyChart.update(); return; }
    monthlyChart = new Chart(canvasEl, {
      type: "bar",
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (ctx) => "₹" + ctx.parsed.y.toLocaleString("en-IN")
        } } },
        scales: {
          y: { beginAtZero: true, ticks: { color: "#9cafc7", callback: v => "₹" + v.toLocaleString("en-IN") }, grid: { color: "rgba(148,201,255,.12)" } },
          x: { ticks: { color: "#9cafc7" }, grid: { display: false } }
        }
      }
    });
  }

  function renderCategoryPie(canvasEl, records, categories) {
    const totals = categories.map(c => records.filter(r => r.category === c.value).reduce((s, r) => s + Number(r.amount), 0));
    const data = {
      labels: categories.map(c => c.label),
      datasets: [{ data: totals, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#0a1020" }]
    };
    if (pieChart) { pieChart.data = data; pieChart.update(); return; }
    pieChart = new Chart(canvasEl, {
      type: "doughnut",
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#dbeaff", boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ₹${ctx.parsed.toLocaleString("en-IN")}` } } }
      }
    });
  }

  function renderComparison(canvasEl, records) {
    const { labels, values } = buildMonthlyTotals(records);
    const data = {
      labels,
      datasets: [{
        label: "Monthly Total",
        data: values,
        borderColor: "#5bd5ff",
        backgroundColor: "rgba(91,213,255,.14)",
        fill: true, tension: .3, pointBackgroundColor: "#5bd5ff"
      }]
    };
    if (comparisonChart) { comparisonChart.data = data; comparisonChart.update(); return; }
    comparisonChart = new Chart(canvasEl, {
      type: "line",
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label: (ctx) => "₹" + ctx.parsed.y.toLocaleString("en-IN")
        } } },
        scales: { y: { beginAtZero: true, ticks: { color: "#9cafc7", callback: v => "₹" + v.toLocaleString("en-IN") }, grid: { color: "rgba(148,201,255,.12)" } }, x: { ticks: { color: "#9cafc7" }, grid: { color: "rgba(148,201,255,.08)" } } }
      }
    });
  }

  return { renderMonthly, renderCategoryPie, renderComparison };
})();
