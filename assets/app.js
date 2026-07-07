(() => {
"use strict";

/* =========================================================================
   CONFIG
   ========================================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBdVhjxW5btyVGFw5H2HS52JhLDkACu1EY7un_57jtWcgVmYVFPyTj647pRv6fKyw33ID3YIzcoozK/pub?gid=0&single=true&output=csv";
const PAGE_SIZE = 15;

const THEME_DEFS = [
  { name: "Thesis & Capstone", color: "var(--series-5)",
    patterns: [/\bthesis\b/, /\bcapstone\b/, /\bdissertation\b/, /\bdefense\b/, /\bproposal\b/, /\bccs999/, /writing\s*[123]\b/] },
  { name: "Practicum & Internship", color: "var(--series-2)",
    patterns: [/\bpracticum\b/, /\bojt\b/, /\bintern(ship)?\b/, /\bprct/, /\bprc-/, /\bprcie/, /\bprcne/, /\bprcis/, /\bmoa\b/, /\biom\b/, /\bhte\b/] },
  { name: "Shifting & Program Change", color: "var(--series-6)",
    patterns: [/\bshift(ing|ed|s)?\b/, /change\s+of\s+program/] },
  { name: "Grades & Academic Standing", color: "var(--series-7)",
    patterns: [/\bgrade[sd]?\b/, /\bgwa\b/, /\bfail(ed|ing)?\b/, /\bretake\b/, /academic\s+(standing|probation)/, /dean.?s\s+list/, /\bcog\b/, /\btor\b/] },
  { name: "Leave of Absence / Returnee", color: "var(--series-8)",
    patterns: [/\bloa\b/, /leave of absence/, /\breturnee\b/] },
  { name: "Fees & Payment", color: "var(--series-3)",
    patterns: [/\bfee[s]?\b/, /\bpayment\b/, /\bmisc\b/, /\btuition\b/, /\brefund\b/, /\bassessment\b/, /\bbilling\b/] },
  { name: "Curriculum & Degree Program", color: "var(--series-4)",
    patterns: [/\bcurriculum\b/, /course mapping/, /\bderf\b/, /study plan/, /\bflowchart\b/, /\bminor\b/, /program eligib/] },
  { name: "Enrollment & Enlistment", color: "var(--series-1)",
    patterns: [/\benlist/, /\benroll/, /archer/, /\bah\b/, /add.?drop/, /\badd(ing|ed)?\b/, /\bdrop(ping|ped)?\b/, /\bsection[s]?\b/, /\bslot[s]?\b/, /\bconfirm/, /\bclass(es)?\b/, /\bcourse[s]?\b/, /\boffering\b/, /\bresidency\b/, /\belective[s]?\b/, /special class/, /\bcredit(ing|ed)?\b/, /\bpetition/, /\bsubject[s]?\b/] },
];
const OTHER_THEME = { name: "General Inquiries / Others", color: "var(--series-other)" };

const STATUS_ORDER = ["Resolved", "Transferred", "In Progress"];
const STATUS_META = {
  "Resolved":    { cssClass: "resolved",    color: "var(--good)" },
  "Transferred": { cssClass: "transferred", color: "var(--series-1)" },
  "In Progress": { cssClass: "inprogress",  color: "var(--warning)" },
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* =========================================================================
   STATE
   ========================================================================= */
const state = {
  records: [],
  months: [],          // [{key:'2026-05', label:'May 2026'}]
  selectedMonth: null,
  statusFilter: new Set(),
  themeFilter: new Set(),
  searchText: "",
  sortKey: null,
  sortDir: 1,
  page: 1,
  activeThemeBar: null, // theme clicked in chart (separate quick-filter)
};

/* =========================================================================
   CSV PARSER (RFC4180-safe: quotes, embedded commas/newlines, "" escapes)
   ========================================================================= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1)
    .filter(r => r.some(v => v && v.trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
      return obj;
    });
  return { headers, rows: dataRows };
}

/* =========================================================================
   CLASSIFICATION & TRANSFORM
   ========================================================================= */
function classifyTheme(description) {
  const d = (description || "").toLowerCase();
  for (const t of THEME_DEFS) {
    for (const p of t.patterns) {
      if (p.test(d)) return t;
    }
  }
  return OTHER_THEME;
}

function themeColor(name) {
  const t = THEME_DEFS.find(t => t.name === name);
  return t ? t.color : OTHER_THEME.color;
}

function normalizeStatus(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (s.startsWith("resolved")) return "Resolved";
  if (s.startsWith("transferred")) return "Transferred";
  if (s.startsWith("in progress")) return "In Progress";
  return "In Progress"; // blank / unspecified -> treat as still in progress
}

function parseQueueDate(queueNumber) {
  const m = /^(\d{4})(\d{2})(\d{2})-\d+$/.exec((queueNumber || "").trim());
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, day);
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabelOf(key) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function buildRecords(rawRows) {
  return rawRows
    .filter(r => (r["Queue Number"] || "").trim() !== "" || (r["Brief Description of Concern or Inquiry"] || "").trim() !== "")
    .map(r => {
      const date = parseQueueDate(r["Queue Number"]);
      const theme = classifyTheme(r["Brief Description of Concern or Inquiry"]);
      const status = normalizeStatus(r["Concern Status"]);
      const destination = (r["Referred to Another Office"] || "").trim();
      return {
        queueNumber: r["Queue Number"] || "(no ID)",
        office: r["Office Needed to Contact"] || "",
        degreeProgram: r["Degree Program (please skip this question, if you are not a student)"] || "",
        description: r["Brief Description of Concern or Inquiry"] || "",
        status,
        resolution: r["Resolution"] || "",
        destination,
        date,
        monthKey: date ? monthKeyOf(date) : null,
        theme: theme.name,
      };
    });
}

/* =========================================================================
   DATA LOADING
   ========================================================================= */
async function loadData({ silent = false, isManual = false } = {}) {
  const statusEl = document.getElementById("load-status");
  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn.classList.add("spinning");
  if (!silent) {
    statusEl.hidden = false;
    statusEl.className = "load-status loading";
    statusEl.textContent = "Fetching latest data from Google Sheets…";
  }
  try {
    const url = CSV_URL + (CSV_URL.includes("?") ? "&" : "?") + "cachebust=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet request failed (HTTP ${res.status})`);
    const text = await res.text();
    const { rows } = parseCSV(text);
    if (rows.length === 0) throw new Error("The published sheet returned no rows.");
    state.records = buildRecords(rows);

    const monthKeys = Array.from(new Set(state.records.filter(r => r.monthKey).map(r => r.monthKey))).sort();
    state.months = monthKeys.map(key => ({ key, label: monthLabelOf(key) }));
    if (!state.selectedMonth || !monthKeys.includes(state.selectedMonth)) {
      state.selectedMonth = monthKeys[monthKeys.length - 1] || null;
    }

    statusEl.hidden = true;
    document.getElementById("last-updated").textContent =
      `${state.records.length} logged queries · updated ${new Date().toLocaleString()}`;
    renderAll();
    if (isManual) showToast("Dashboard refreshed");
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.className = "load-status error";
    statusEl.textContent = `Couldn't load the spreadsheet (${err.message}). Check your connection and try Refresh.`;
    document.getElementById("last-updated").textContent = "Data unavailable";
  } finally {
    refreshBtn.classList.remove("spinning");
  }
}

/* =========================================================================
   HELPERS
   ========================================================================= */
function fmtNum(n) { return n.toLocaleString("en-US"); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function countBy(records, key) {
  const m = new Map();
  for (const r of records) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
}

function prevMonthKey(key) {
  const idx = state.months.findIndex(m => m.key === key);
  return idx > 0 ? state.months[idx - 1].key : null;
}

/* =========================================================================
   RENDER: overall + monthly stat tiles
   ========================================================================= */
function renderStatTile(container, statName, value, deltaHTML, deltaClass) {
  const tile = container.querySelector(`[data-stat="${statName}"]`);
  if (!tile) return;
  tile.querySelector(".stat-value").textContent = fmtNum(value);
  const deltaEl = tile.querySelector(".stat-delta");
  deltaEl.innerHTML = deltaHTML || "";
  deltaEl.className = "stat-delta" + (deltaClass ? " " + deltaClass : "");
}

function renderOverallStats() {
  const all = state.records;
  const total = all.length;
  const resolved = all.filter(r => r.status === "Resolved").length;
  const transferred = all.filter(r => r.status === "Transferred").length;
  const inProgress = all.filter(r => r.status === "In Progress").length;
  const c = document.getElementById("overall-stats");
  renderStatTile(c, "handled", total, `All-time record count`, "flat");
  renderStatTile(c, "resolved", resolved, `▲ ${pct(resolved, total)}% of total`, "up");
  renderStatTile(c, "transferred", transferred, `${pct(transferred, total)}% of total`, "flat");
  renderStatTile(c, "inprogress", inProgress, `${pct(inProgress, total)}% of total`, inProgress > 0 ? "down" : "flat");
}

function renderMonthStats() {
  const key = state.selectedMonth;
  const c = document.getElementById("month-stats");
  if (!key) {
    ["handled","resolved","transferred","inprogress"].forEach(s => renderStatTile(c, s, 0, "No data", "flat"));
    return;
  }
  const rows = state.records.filter(r => r.monthKey === key);
  const total = rows.length;
  const resolved = rows.filter(r => r.status === "Resolved").length;
  const transferred = rows.filter(r => r.status === "Transferred").length;
  const inProgress = rows.filter(r => r.status === "In Progress").length;

  const prevKey = prevMonthKey(key);
  const prevTotal = prevKey ? state.records.filter(r => r.monthKey === prevKey).length : null;

  let handledDelta = "First month on record", handledClass = "flat";
  if (prevTotal !== null) {
    const diff = pct(total - prevTotal, prevTotal || 1);
    if (total > prevTotal) { handledDelta = `▲ ${Math.abs(diff)}% vs last month`; handledClass = "up"; }
    else if (total < prevTotal) { handledDelta = `▼ ${Math.abs(diff)}% vs last month`; handledClass = "down"; }
    else { handledDelta = `No change vs last month`; handledClass = "flat"; }
  }

  renderStatTile(c, "handled", total, handledDelta, handledClass);
  renderStatTile(c, "resolved", resolved, `${pct(resolved, total)}% resolution rate`, "up");
  renderStatTile(c, "transferred", transferred, `${pct(transferred, total)}% of month`, "flat");
  renderStatTile(c, "inprogress", inProgress, `${pct(inProgress, total)}% of month`, inProgress > 0 ? "down" : "flat");
}

/* =========================================================================
   RENDER: month selector
   ========================================================================= */
function renderMonthSelect() {
  const sel = document.getElementById("month-select");
  sel.innerHTML = state.months.map(m =>
    `<option value="${m.key}" ${m.key === state.selectedMonth ? "selected" : ""}>${m.label}</option>`
  ).join("");
}

/* =========================================================================
   RENDER: theme bar chart
   ========================================================================= */
function renderThemeChart() {
  const key = state.selectedMonth;
  const rows = state.records.filter(r => r.monthKey === key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("theme-chart-title").textContent = `🔍 What Were Clients Inquiring About in ${label}?`;

  const counts = countBy(rows, "theme");
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const total = rows.length;

  const chart = document.getElementById("theme-chart");
  chart.innerHTML = entries.map(([theme, count]) => {
    const widthPct = Math.max((count / max) * 100, 2);
    const color = themeColor(theme);
    const isActive = state.activeThemeBar === theme;
    const dimmed = state.activeThemeBar && !isActive ? "dimmed" : "";
    return `
      <div class="chart-row ${isActive ? "active" : ""}" data-theme="${escapeAttr(theme)}">
        <span class="bar-label" title="${escapeAttr(theme)}">${escapeHTML(theme)}</span>
        <span class="bar-track">
          <span class="bar-fill ${dimmed}" data-theme-bar="${escapeAttr(theme)}"
                style="width:${widthPct}%; background:${color}"
                data-tooltip="${escapeAttr(theme)}: ${count} (${pct(count, total)}%)"></span>
        </span>
        <span class="bar-value">${count}</span>
      </div>`;
  }).join("") || `<p class="card-hint">No queries recorded for this month.</p>`;

  chart.querySelectorAll(".bar-fill").forEach(bar => {
    bar.addEventListener("mouseenter", showBarTooltip);
    bar.addEventListener("mousemove", showBarTooltip);
    bar.addEventListener("mouseleave", hideBarTooltip);
    bar.addEventListener("click", () => {
      const theme = bar.dataset.themeBar;
      state.activeThemeBar = state.activeThemeBar === theme ? null : theme;
      state.themeFilter = new Set(state.activeThemeBar ? [state.activeThemeBar] : []);
      state.page = 1;
      renderThemeChart();
      renderFilterChips();
      renderAuditTable();
      document.getElementById("audit-body").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

let tooltipEl = null;
function showBarTooltip(e) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "bar-tooltip";
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.textContent = e.currentTarget.dataset.tooltip;
  tooltipEl.style.left = e.clientX + "px";
  tooltipEl.style.top = e.clientY + "px";
  tooltipEl.classList.add("visible");
}
function hideBarTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("visible");
}

/* =========================================================================
   RENDER: filter chips (status + theme)
   ========================================================================= */
function renderFilterChips() {
  const monthRows = state.records.filter(r => !state.selectedMonth || r.monthKey === state.selectedMonth);

  const statusCounts = countBy(monthRows, "status");
  const statusWrap = document.getElementById("status-chips");
  statusWrap.innerHTML = STATUS_ORDER.map(s => {
    const count = statusCounts.get(s) || 0;
    const selected = state.statusFilter.has(s);
    return `<button type="button" class="chip ${selected ? "selected" : ""}" data-status="${s}">
      <span class="dot" style="background:${STATUS_META[s].color}"></span>${s} <span class="count">${count}</span>
    </button>`;
  }).join("");
  statusWrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const s = chip.dataset.status;
      state.statusFilter.has(s) ? state.statusFilter.delete(s) : state.statusFilter.add(s);
      state.page = 1;
      renderFilterChips();
      renderAuditTable();
    });
  });

  const themeCounts = countBy(monthRows, "theme");
  const allThemeNames = [...THEME_DEFS.map(t => t.name), OTHER_THEME.name];
  const themeWrap = document.getElementById("theme-chips");
  themeWrap.innerHTML = allThemeNames.filter(t => themeCounts.get(t)).map(t => {
    const count = themeCounts.get(t) || 0;
    const selected = state.themeFilter.has(t);
    return `<button type="button" class="chip ${selected ? "selected" : ""}" data-theme="${escapeAttr(t)}">
      <span class="dot" style="background:${themeColor(t)}"></span>${escapeHTML(t)} <span class="count">${count}</span>
    </button>`;
  }).join("");
  themeWrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const t = chip.dataset.theme;
      state.themeFilter.has(t) ? state.themeFilter.delete(t) : state.themeFilter.add(t);
      state.activeThemeBar = state.themeFilter.size === 1 ? [...state.themeFilter][0] : null;
      state.page = 1;
      renderFilterChips();
      renderThemeChart();
      renderAuditTable();
    });
  });
}

/* =========================================================================
   RENDER: audit log table
   ========================================================================= */
function getFilteredRows() {
  let rows = state.records.filter(r => !state.selectedMonth || r.monthKey === state.selectedMonth);
  if (state.statusFilter.size) rows = rows.filter(r => state.statusFilter.has(r.status));
  if (state.themeFilter.size) rows = rows.filter(r => state.themeFilter.has(r.theme));
  if (state.searchText) {
    const q = state.searchText.toLowerCase();
    rows = rows.filter(r => r.description.toLowerCase().includes(q) || r.resolution.toLowerCase().includes(q));
  }
  if (state.sortKey) {
    rows = [...rows].sort((a, b) => {
      const av = (a[state.sortKey] || "").toString().toLowerCase();
      const bv = (b[state.sortKey] || "").toString().toLowerCase();
      return av < bv ? -1 * state.sortDir : av > bv ? 1 * state.sortDir : 0;
    });
  }
  return rows;
}

function escapeHTML(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHTML(s).replace(/`/g, "&#96;"); }

function renderAuditTable() {
  const rows = getFilteredRows();
  const monthLabel = state.selectedMonth ? monthLabelOf(state.selectedMonth) : "all time";
  document.getElementById("audit-title").textContent = `🔎 View & Filter Detailed Audit Log for ${monthLabel} (${rows.length} items)`;
  document.getElementById("table-count").textContent =
    `Showing ${rows.length} ${rows.length === 1 ? "entry" : "entries"} matching current filters`;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById("audit-tbody");
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">No entries match these filters.</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const meta = STATUS_META[r.status];
      return `
      <tr>
        <td>${escapeHTML(r.queueNumber)}</td>
        <td><span class="theme-tag"><span class="dot" style="background:${themeColor(r.theme)}"></span>${escapeHTML(r.theme)}</span></td>
        <td class="desc-cell"><div class="clamp">${escapeHTML(r.description) || "—"}</div>${r.description.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
        <td><span class="status-tag ${meta.cssClass}">${r.status}</span></td>
        <td class="resolution-cell"><div class="clamp">${escapeHTML(r.resolution) || "—"}</div>${r.resolution.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
      </tr>`;
    }).join("");
    tbody.querySelectorAll("[data-expand]").forEach(btn => {
      btn.addEventListener("click", () => {
        const clamp = btn.previousElementSibling;
        clamp.classList.toggle("expanded");
        btn.textContent = clamp.classList.contains("expanded") ? "Show less" : "Show more";
      });
    });
  }

  renderPagination(rows.length);

  document.querySelectorAll("#audit-table th[data-sort]").forEach(th => {
    th.classList.toggle("sorted", th.dataset.sort === state.sortKey);
    th.classList.toggle("asc", th.dataset.sort === state.sortKey && state.sortDir === 1);
  });
}

function renderPagination(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const wrap = document.getElementById("pagination");
  let html = `<button class="page-btn" id="page-prev" ${state.page <= 1 ? "disabled" : ""}>‹ Prev</button>`;
  const windowSize = 5;
  let startPage = Math.max(1, state.page - Math.floor(windowSize / 2));
  let endPage = Math.min(totalPages, startPage + windowSize - 1);
  startPage = Math.max(1, endPage - windowSize + 1);
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" id="page-next" ${state.page >= totalPages ? "disabled" : ""}>Next ›</button>`;
  wrap.innerHTML = html;
  wrap.querySelector("#page-prev")?.addEventListener("click", () => { state.page--; renderAuditTable(); });
  wrap.querySelector("#page-next")?.addEventListener("click", () => { state.page++; renderAuditTable(); });
  wrap.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => { state.page = +btn.dataset.page; renderAuditTable(); });
  });
}

/* =========================================================================
   RENDER: destination breakdown
   ========================================================================= */
function renderDestinationTable() {
  const rows = state.records.filter(r => r.destination);
  const counts = countBy(rows, "destination");
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const tbody = document.getElementById("dest-tbody");
  tbody.innerHTML = entries.length
    ? entries.map(([dest, count], i) => `<tr><td>${i + 1}</td><td>${escapeHTML(dest)}</td><td>${count}</td></tr>`).join("")
    : `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px;">No referred-destination data yet.</td></tr>`;
}

/* =========================================================================
   EXPORT
   ========================================================================= */
function exportFilteredCSV() {
  const rows = getFilteredRows();
  const headers = ["Queue Number", "Identified Theme", "Description", "Concern Status", "Resolution", "Referred To"];
  const csvEscape = v => `"${(v || "").toString().replace(/"/g, '""')}"`;
  const lines = [headers.join(",")].concat(
    rows.map(r => [r.queueNumber, r.theme, r.description, r.status, r.resolution, r.destination].map(csvEscape).join(","))
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ccs-vo-audit-log-${state.selectedMonth || "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${rows.length} rows`);
}

/* =========================================================================
   RENDER ALL
   ========================================================================= */
function renderAll() {
  renderOverallStats();
  renderMonthSelect();
  renderMonthStats();
  renderThemeChart();
  renderFilterChips();
  renderAuditTable();
  renderDestinationTable();
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function wireEvents() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => { t.classList.remove("tab-active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("tab-active");
      tab.setAttribute("aria-selected", "true");
      const target = tab.dataset.tab;
      document.getElementById("tab-operations").hidden = target !== "operations";
      document.getElementById("tab-evaluation").hidden = target !== "evaluation";
    });
  });

  document.getElementById("month-select").addEventListener("change", e => {
    state.selectedMonth = e.target.value;
    state.page = 1;
    state.activeThemeBar = null;
    state.themeFilter.clear();
    renderMonthStats();
    renderThemeChart();
    renderFilterChips();
    renderAuditTable();
  });

  document.getElementById("search-input").addEventListener("input", e => {
    state.searchText = e.target.value.trim();
    state.page = 1;
    renderAuditTable();
  });

  document.getElementById("clear-filters-btn").addEventListener("click", () => {
    state.statusFilter.clear();
    state.themeFilter.clear();
    state.activeThemeBar = null;
    state.searchText = "";
    document.getElementById("search-input").value = "";
    state.page = 1;
    renderFilterChips();
    renderThemeChart();
    renderAuditTable();
  });

  document.getElementById("export-btn").addEventListener("click", exportFilteredCSV);

  document.querySelectorAll("#audit-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      if (state.sortKey === th.dataset.sort) state.sortDir *= -1;
      else { state.sortKey = th.dataset.sort; state.sortDir = 1; }
      renderAuditTable();
    });
  });

  document.getElementById("refresh-btn").addEventListener("click", () => loadData({ isManual: true }));
  document.getElementById("footer-refresh").addEventListener("click", () => loadData({ isManual: true }));

  [["audit-toggle", "audit-body"], ["dest-toggle", "dest-body"]].forEach(([toggleId, bodyId]) => {
    document.getElementById(toggleId).addEventListener("click", () => {
      const btn = document.getElementById(toggleId);
      const body = document.getElementById(bodyId);
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
    });
  });

  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("ccs-vo-theme", next);
  });
  const savedTheme = localStorage.getItem("ccs-vo-theme");
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
}

/* =========================================================================
   INIT
   ========================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  loadData();
});

})();
