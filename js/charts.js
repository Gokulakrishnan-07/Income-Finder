/* ============================================================
   charts.js — Chart.js instances for Scrap Ledger
   ============================================================ */
const ScrapCharts = (() => {
  let monthlyChart = null;
  let pieChart = null;
  let comparisonChart = null;

  const PALETTE = ["#B4862B", "#4C6B57", "#B24A2A", "#C47B28", "#B85C38", "#5C7896"];

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
        backgroundColor: "#B24A2A",
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
          y: { beginAtZero: true, ticks: { callback: v => "₹" + v.toLocaleString("en-IN") } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderCategoryPie(canvasEl, records, categories) {
    const totals = categories.map(c => records.filter(r => r.category === c.value).reduce((s, r) => s + Number(r.amount), 0));
    const data = {
      labels: categories.map(c => c.label),
      datasets: [{ data: totals, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#FFFDF8" }]
    };
    if (pieChart) { pieChart.data = data; pieChart.update(); return; }
    pieChart = new Chart(canvasEl, {
      type: "doughnut",
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
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
        borderColor: "#4C6B57",
        backgroundColor: "rgba(76,107,87,.15)",
        fill: true, tension: .3, pointBackgroundColor: "#4C6B57"
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
        scales: { y: { beginAtZero: true, ticks: { callback: v => "₹" + v.toLocaleString("en-IN") } } }
      }
    });
  }

  return { renderMonthly, renderCategoryPie, renderComparison };
})();
