(() => {
"use strict";

/* =========================================================================
   CONFIG
   ========================================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBdVhjxW5btyVGFw5H2HS52JhLDkACu1EY7un_57jtWcgVmYVFPyTj647pRv6fKyw33ID3YIzcoozK/pub?gid=0&single=true&output=csv";
const PAGE_SIZE = 15;


const { THEME_DEFS, OTHER_THEME, ENROLLMENT, SUB_DEFS, OTHER_SUB, classifyTheme, classifySub, themeColor, cleanDestination } = window.VO_CLASSIFY;

const STATUS_ORDER = ["Resolved", "Transferred", "In Progress"];
const STATUS_META = {
  "Resolved":    { cssClass: "resolved",    color: "var(--good)" },
  "Transferred": { cssClass: "transferred", color: "var(--series-1)" },
  "In Progress": { cssClass: "inprogress",  color: "var(--warning)" },
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const EMPTY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M20 7H4a1 1 0 0 0-1 1v3l2.4 6h13.2L21 11V8a1 1 0 0 0-1-1ZM8 4h8l2 3H6l2-3Zm-.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" fill="currentColor"/></svg>';
function emptyNote(text) { return `<p class="empty-note">${EMPTY_ICON}${text}</p>`; }

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
  flagFilter: null,     // follow-up flag id, or null
  subFilter: new Set(), // Enrollment sub-topics
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
  return buildRecordsRaw(rawRows).map(addFlags);
}
function buildRecordsRaw(rawRows) {
  return rawRows
    .filter(r => (r["Queue Number"] || "").trim() !== "" || (r["Brief Description of Concern or Inquiry"] || "").trim() !== "")
    .map(r => {
      const date = parseQueueDate(r["Queue Number"]);
      const theme = classifyTheme(r["Brief Description of Concern or Inquiry"]);
      const subTheme = theme.name === ENROLLMENT ? classifySub(r["Brief Description of Concern or Inquiry"]) : "";
      const status = normalizeStatus(r["Concern Status"]);
      const destination = (r["Referred to Another Office"] || "").trim();
      return {
        queueNumber: r["Queue Number"] || "(no ID)",
        office: r["Office Needed to Contact"] || "",
        degreeProgram: r["Degree Program (please skip this question, if you are not a student)"] || "",
        description: r["Brief Description of Concern or Inquiry"] || "",
        status,
        rawStatus: (r["Concern Status"] || "").trim(),
        resolution: r["Resolution"] || "",
        destination,
        date,
        day: date ? date.getDate() : null,
        monthKey: date ? monthKeyOf(date) : null,
        theme: theme.name,
        subTheme,
      };
    });
}


/* =========================================================================
   DATA QUALITY: destinations and follow-up flags
   ========================================================================= */
const STALE_DAYS = 14;
const FLAGS = [
  { id: "no-status",      label: "Status missing or still \u201cNew\u201d",           hint: "Counted as In Progress until a status is set." },
  { id: "ip-resolved",    label: "In Progress, but a resolution is written",       hint: "Probably finished; the status was never updated." },
  { id: "stale",          label: `In Progress for ${STALE_DAYS}+ days`,            hint: "Open longer than two weeks." },
  { id: "no-resolution",  label: "Resolved without a resolution note",             hint: "Nothing recorded about how it was handled." },
  { id: "no-destination", label: "Transferred without a destination",              hint: "The receiving office is not recorded." },
];
function addFlags(r) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ageDays = r.date ? Math.floor((today - r.date) / 86400000) : null;
  const f = [];
  if (!r.rawStatus || /^new\b/i.test(r.rawStatus)) f.push("no-status");
  if (r.status === "In Progress" && r.resolution.trim().length >= 15) f.push("ip-resolved");
  if (r.status === "In Progress" && ageDays != null && ageDays >= STALE_DAYS) f.push("stale");
  if (r.status === "Resolved" && r.resolution.trim().length < 8) f.push("no-resolution");
  if (r.status === "Transferred" && !cleanDestination(r.destination)) f.push("no-destination");
  r.flags = f;
  r.ageDays = ageDays;
  return r;
}

/* =========================================================================
   DATA LOADING
   ========================================================================= */
const AUTO_REFRESH_MS = 60000;

const SKELETON_CONTAINER_IDS = ["overall-stats", "month-stats", "theme-chart"];
function setLoadingSkeleton(on) {
  SKELETON_CONTAINER_IDS.forEach(id => {
    document.getElementById(id)?.classList.toggle("is-loading", on);
  });
}

async function loadData({ silent = false, isManual = false } = {}) {
  const statusEl = document.getElementById("load-status");
  const liveBadge = document.getElementById("live-badge");
  if (!silent) {
    statusEl.hidden = false;
    statusEl.className = "load-status loading";
    statusEl.textContent = "Fetching latest data from Google Sheets…";
    if (state.records.length === 0) setLoadingSkeleton(true);
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
    document.getElementById("last-updated").textContent = `${state.records.length} logged queries`;
    liveBadge.hidden = false;
    setLoadingSkeleton(false);
    renderAll();
    if (isManual) showToast("Dashboard refreshed");
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.className = "load-status error";
    statusEl.textContent = `Couldn't load the spreadsheet (${err.message}). Retrying automatically every minute.`;
    document.getElementById("last-updated").textContent = "Data unavailable";
    liveBadge.hidden = true;
    setLoadingSkeleton(false);
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
  el.classList.remove("out");
  el.hidden = false;
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  clearTimeout(showToast._t); clearTimeout(showToast._o);
  showToast._t = setTimeout(() => {
    el.classList.add("out");
    showToast._o = setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 180);
  }, 2200);
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
  const stale = all.filter(r => r.flags.includes("stale")).length;
  const c = document.getElementById("overall-stats");
  renderStatTile(c, "handled", total, `All-time record count`, "flat");
  renderStatTile(c, "resolved", resolved, `${pct(resolved, total)}% of total`, "flat");
  renderStatTile(c, "transferred", transferred, `${pct(transferred, total)}% of total`, "flat");
  renderStatTile(c, "inprogress", inProgress, `${pct(inProgress, total)}% of total${stale ? ` · ${fmtNum(stale)} open ${STALE_DAYS}+ days` : ""}`, stale ? "warn" : "flat");
}

function calPrevKey(key) {
  const [y, m] = key.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 2, 1));
}
// The current calendar month is incomplete until its last day.
function partialInfo(key) {
  const now = new Date();
  if (monthKeyOf(now) !== key) return null;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() < last ? { day: now.getDate(), last } : null;
}
const monthShort = key => MONTH_NAMES[+key.split("-")[1] - 1].slice(0, 3);

function renderMonthStats() {
  const key = state.selectedMonth;
  const c = document.getElementById("month-stats");
  const noteEl = document.getElementById("month-note");
  if (!key) {
    ["handled","resolved","transferred","inprogress"].forEach(s => renderStatTile(c, s, 0, "No data", "flat"));
    noteEl.textContent = "";
    return;
  }
  const rows = state.records.filter(r => r.monthKey === key);
  const total = rows.length;
  const resolved = rows.filter(r => r.status === "Resolved").length;
  const transferred = rows.filter(r => r.status === "Transferred").length;
  const inProgress = rows.filter(r => r.status === "In Progress").length;
  const stale = rows.filter(r => r.flags.includes("stale")).length;

  // compare with the previous calendar month, over the same days while this one is still running
  const partial = partialInfo(key);
  const prevKey = calPrevKey(key);
  const prevAll = state.records.filter(r => r.monthKey === prevKey);
  const prevRows = partial ? prevAll.filter(r => r.day != null && r.day <= partial.day) : prevAll;
  let handledDelta;
  if (!prevAll.length) {
    handledDelta = `No data for ${monthLabelOf(prevKey)}`;
  } else {
    const basis = partial ? `vs ${monthShort(prevKey)} 1\u2013${partial.day}` : `vs ${monthShort(prevKey)}`;
    const diff = pct(total - prevRows.length, prevRows.length || 1);
    const arrow = total > prevRows.length ? "\u25B2 " : total < prevRows.length ? "\u25BC " : "";
    handledDelta = total === prevRows.length ? `No change ${basis}` : `${arrow}${Math.abs(diff)}% ${basis}`;
    if (prevRows.length < 30) handledDelta += " \u00B7 small base";
  }

  renderStatTile(c, "handled", total, handledDelta, "flat");
  renderStatTile(c, "resolved", resolved, `${pct(resolved, total)}% resolution rate`, "flat");
  renderStatTile(c, "transferred", transferred, `${pct(transferred, total)}% of month`, "flat");
  renderStatTile(c, "inprogress", inProgress, `${pct(inProgress, total)}% of month${stale ? ` \u00B7 ${stale} open ${STALE_DAYS}+ days` : ""}`, stale ? "warn" : "flat");

  noteEl.textContent = partial
    ? `Month to date (1\u2013${partial.day} ${MONTH_NAMES[+key.split("-")[1] - 1]}). The comparison uses the same days of the previous month.`
    : total < 30 ? `Low-volume month (${total} queries): percentages swing widely with a few records.` : "";
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
   RENDER: monthly volume trend
   ========================================================================= */
function renderTrend() {
  const wrap = document.getElementById("trend-chart");
  const withDate = state.records.filter(r => r.monthKey);
  if (!withDate.length) { wrap.innerHTML = emptyNote("No dated records yet."); return; }
  const keys = [];
  const first = withDate.reduce((a, r) => (r.monthKey < a ? r.monthKey : a), withDate[0].monthKey);
  const last = withDate.reduce((a, r) => (r.monthKey > a ? r.monthKey : a), withDate[0].monthKey);
  for (let [y, m] = first.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= last; m === 12 ? (y++, m = 1) : m++) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  const stats = keys.map(k => {
    const rows = withDate.filter(r => r.monthKey === k);
    return { key: k, total: rows.length,
      resolved: rows.filter(r => r.status === "Resolved").length,
      transferred: rows.filter(r => r.status === "Transferred").length,
      inProgress: rows.filter(r => r.status === "In Progress").length,
      partial: !!partialInfo(k) };
  });
  const max = Math.max(...stats.map(x => x.total), 1);
  wrap.innerHTML = stats.map(x => {
    const h = x.total ? Math.max(x.total / max, 0.02) : 0;
    const sel = x.key === state.selectedMonth;
    const tip = `${monthLabelOf(x.key)}${x.partial ? " (month to date)" : ""}: ${x.total} queries \u2014 ${x.resolved} resolved, ${x.transferred} transferred, ${x.inProgress} in progress`;
    return `<button type="button" class="trend-col${sel ? " selected" : ""}" data-month="${x.key}" aria-pressed="${sel}" aria-label="${escapeAttr(tip)}">
      <span class="trend-plot">
        <span class="trend-value">${fmtNum(x.total)}</span>
        <span class="trend-bar${x.partial ? " partial" : ""}" style="--h:${h.toFixed(4)}" data-tooltip="${escapeAttr(tip)}"></span>
      </span>
      <span class="trend-label">${monthShort(x.key)}${x.partial ? "<small>MTD</small>" : ""}</span>
    </button>`;
  }).join("");
  wrap.querySelectorAll(".trend-bar").forEach(bar => {
    bar.addEventListener("mouseenter", showBarTooltip);
    bar.addEventListener("mousemove", showBarTooltip);
    bar.addEventListener("mouseleave", hideBarTooltip);
  });
  wrap.querySelectorAll(".trend-col").forEach(col => {
    col.addEventListener("click", () => {
      const sel = document.getElementById("month-select");
      sel.value = col.dataset.month;
      sel.dispatchEvent(new Event("change"));
    });
  });
  document.getElementById("trend-table-body").innerHTML = stats.map(x =>
    `<tr><td>${monthLabelOf(x.key)}${x.partial ? " (to date)" : ""}</td><td class="num">${x.total}</td><td class="num">${x.resolved}</td><td class="num">${x.transferred}</td><td class="num">${x.inProgress}</td><td class="num">${pct(x.inProgress, x.total)}%</td></tr>`
  ).join("");
}

/* =========================================================================
   RENDER: records needing follow-up
   ========================================================================= */
function renderFollowUp() {
  const key = state.selectedMonth;
  const monthRows = state.records.filter(r => !key || r.monthKey === key);
  const label = key ? monthLabelOf(key) : "all time";
  document.getElementById("followup-title").textContent = `Records Needing Follow-up in ${label}`;
  const total = FLAGS.reduce((a, f) => a + monthRows.filter(r => r.flags.includes(f.id)).length, 0);
  document.getElementById("followup-list").innerHTML = FLAGS.map(f => {
    const n = monthRows.filter(r => r.flags.includes(f.id)).length;
    const all = state.records.filter(r => r.flags.includes(f.id)).length;
    return `<li class="followup-row${n ? "" : " is-clear"}">
      <span class="followup-text"><strong>${escapeHTML(f.label)}</strong><span class="followup-hint">${escapeHTML(f.hint)} All time: ${fmtNum(all)}.</span></span>
      <span class="followup-count num">${n ? fmtNum(n) : "None"}</span>
      ${n ? `<button type="button" class="secondary-btn" data-flag="${f.id}">Review</button>` : `<span class="followup-spacer"></span>`}
    </li>`;
  }).join("");
  document.getElementById("followup-summary").textContent = total
    ? `${fmtNum(total)} flag${total === 1 ? "" : "s"} in ${label}. These records can make statuses and rates look different from what actually happened.`
    : `No flags in ${label}.`;
  document.querySelectorAll("#followup-list [data-flag]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.flagFilter = btn.dataset.flag;
      state.statusFilter.clear(); state.themeFilter.clear(); state.activeThemeBar = null;
      state.searchText = ""; document.getElementById("search-input").value = "";
      state.page = 1;
      renderFilterChips(); renderThemeChart(); renderAuditTable();
      document.getElementById("audit-body").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* =========================================================================
   RENDER: theme bar chart
   ========================================================================= */
function renderThemeChart() {
  const key = state.selectedMonth;
  const rows = state.records.filter(r => r.monthKey === key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("theme-chart-title").textContent = `What Were Clients Inquiring About in ${label}?`;

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
  }).join("") || emptyNote("No queries recorded for this month.");

  chart.querySelectorAll(".bar-fill").forEach(bar => {
    bar.addEventListener("mouseenter", showBarTooltip);
    bar.addEventListener("mousemove", showBarTooltip);
    bar.addEventListener("mouseleave", hideBarTooltip);
    bar.addEventListener("click", () => {
      const theme = bar.dataset.themeBar;
      state.activeThemeBar = state.activeThemeBar === theme ? null : theme;
      state.themeFilter.clear();
      state.subFilter.clear();
      if (state.activeThemeBar) state.themeFilter.add(state.activeThemeBar);
      state.page = 1;
      renderThemeChart();
      renderSubTopics();
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
   RENDER: Enrollment sub-topics
   ========================================================================= */
function renderSubTopics() {
  const key = state.selectedMonth;
  const monthRows = state.records.filter(r => !key || r.monthKey === key);
  const enr = monthRows.filter(r => r.theme === ENROLLMENT);
  const card = document.getElementById("sub-card");
  const label = key ? monthLabelOf(key) : "all time";
  card.hidden = enr.length === 0;
  if (!enr.length) return;
  document.getElementById("sub-title").textContent = `Inside Enrollment & Enlistment in ${label}`;
  document.getElementById("sub-hint").textContent =
    `${fmtNum(enr.length)} queries, ${pct(enr.length, monthRows.length)}% of the month. Click a sub-topic to filter the audit log below.`;
  const counts = countBy(enr, "subTheme");
  const order = [...SUB_DEFS.map(s => s.name), OTHER_SUB];
  const entries = order.filter(n => counts.get(n)).map(n => [n, counts.get(n)]).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  const chart = document.getElementById("sub-chart");
  chart.innerHTML = entries.map(([name, count]) => {
    const active = state.subFilter.has(name);
    const dimmed = state.subFilter.size && !active ? "dimmed" : "";
    const color = name === OTHER_SUB ? "var(--series-other)" : themeColor(ENROLLMENT);
    return `
      <div class="chart-row ${active ? "active" : ""}">
        <span class="bar-label" title="${escapeAttr(name)}">${escapeHTML(name)}</span>
        <span class="bar-track">
          <span class="bar-fill ${dimmed}" data-sub-bar="${escapeAttr(name)}" style="width:${Math.max((count / max) * 100, 2)}%; background:${color}"
                data-tooltip="${escapeAttr(name)}: ${count} (${pct(count, enr.length)}% of Enrollment)"></span>
        </span>
        <span class="bar-value">${count}</span>
      </div>`;
  }).join("");
  chart.querySelectorAll(".bar-fill").forEach(bar => {
    bar.addEventListener("mouseenter", showBarTooltip);
    bar.addEventListener("mousemove", showBarTooltip);
    bar.addEventListener("mouseleave", hideBarTooltip);
    bar.addEventListener("click", () => {
      const n = bar.dataset.subBar;
      state.subFilter.has(n) ? state.subFilter.delete(n) : state.subFilter.add(n);
      state.themeFilter.clear(); state.themeFilter.add(ENROLLMENT);
      state.activeThemeBar = ENROLLMENT;
      state.page = 1;
      renderSubTopics(); renderThemeChart(); renderFilterChips(); renderAuditTable();
      document.getElementById("audit-body").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* =========================================================================
   RENDER: filter chips (status + theme) — always-visible clickable pills
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

  const flagWrap = document.getElementById("flag-chips");
  flagWrap.innerHTML = FLAGS.map(f => {
    const count = monthRows.filter(r => r.flags.includes(f.id)).length;
    const selected = state.flagFilter === f.id;
    return `<button type="button" class="chip ${selected ? "selected" : ""}" data-flag="${f.id}" title="${escapeAttr(f.hint)}">${escapeHTML(f.label)} <span class="count">${count}</span></button>`;
  }).join("");
  flagWrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.flagFilter = state.flagFilter === chip.dataset.flag ? null : chip.dataset.flag;
      state.page = 1;
      renderFilterChips();
      renderAuditTable();
    });
  });

  const subCounts = countBy(monthRows.filter(r => r.subTheme), "subTheme");
  const subWrap = document.getElementById("sub-chips");
  document.getElementById("sub-group").hidden = subCounts.size === 0;
  subWrap.innerHTML = [...SUB_DEFS.map(x => x.name), OTHER_SUB].filter(n => subCounts.get(n)).map(n => {
    const selected = state.subFilter.has(n);
    return `<button type="button" class="chip ${selected ? "selected" : ""}" data-sub="${escapeAttr(n)}">${escapeHTML(n)} <span class="count">${subCounts.get(n)}</span></button>`;
  }).join("");
  subWrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const n = chip.dataset.sub;
      state.subFilter.has(n) ? state.subFilter.delete(n) : state.subFilter.add(n);
      if (state.subFilter.size) { state.themeFilter.clear(); state.themeFilter.add(ENROLLMENT); state.activeThemeBar = ENROLLMENT; }
      state.page = 1;
      renderSubTopics(); renderThemeChart(); renderFilterChips(); renderAuditTable();
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
      if (!state.themeFilter.has(ENROLLMENT)) state.subFilter.clear();
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
  if (state.subFilter.size) rows = rows.filter(r => state.subFilter.has(r.subTheme));
  if (state.flagFilter) rows = rows.filter(r => r.flags.includes(state.flagFilter));
  if (state.searchText) {
    const q = state.searchText.toLowerCase();
    rows = rows.filter(r => r.description.toLowerCase().includes(q) || r.resolution.toLowerCase().includes(q));
  }
  if (state.sortKey) {
    rows = [...rows].sort((a, b) => {
      // numeric-aware, so 20261009-2 sorts before 20261009-10
      const av = (a[state.sortKey] || "").toString();
      const bv = (b[state.sortKey] || "").toString();
      return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * state.sortDir;
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
  document.getElementById("audit-title").textContent = `View & Filter Detailed Audit Log for ${monthLabel} (${rows.length} items)`;
  document.getElementById("table-count").textContent =
    `Showing ${rows.length} ${rows.length === 1 ? "entry" : "entries"} matching current filters`;

  const showDestinationCol = state.statusFilter.has("Transferred");

  const theadRow = document.getElementById("audit-thead-row");
  theadRow.innerHTML = `
    <th data-sort="queueNumber" tabindex="0" role="button">Query Number</th>
    <th data-sort="theme" tabindex="0" role="button">Identified Theme</th>
    <th data-sort="description" tabindex="0" role="button">Brief Description of Concern or Inquiry</th>
    <th data-sort="status" tabindex="0" role="button">Concern Status</th>
    <th>Resolution</th>
    ${showDestinationCol ? '<th>Destination Unit / Office</th>' : ""}
  `;
  const colCount = showDestinationCol ? 6 : 5;

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById("audit-tbody");
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="padding:24px;"><p class="empty-note" style="justify-content:center;">${EMPTY_ICON}No entries match these filters.</p></td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const meta = STATUS_META[r.status];
      return `
      <tr>
        <td>${escapeHTML(r.queueNumber)}</td>
        <td><span class="theme-tag"><span class="dot" style="background:${themeColor(r.theme)}"></span>${escapeHTML(r.theme)}</span>${r.subTheme ? `<div class="sub-tag">${escapeHTML(r.subTheme)}</div>` : ""}</td>
        <td class="desc-cell"><div class="clamp">${escapeHTML(r.description) || "—"}</div>${r.description.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
        <td><span class="status-tag ${meta.cssClass}">${r.status}</span></td>
        <td class="resolution-cell"><div class="clamp">${escapeHTML(r.resolution) || "—"}</div>${r.resolution.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
        ${showDestinationCol ? `<td>${escapeHTML(r.destination) || "—"}</td>` : ""}
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

  theadRow.querySelectorAll("th[data-sort]").forEach(th => {
    const isSorted = th.dataset.sort === state.sortKey;
    th.classList.toggle("sorted", isSorted);
    th.classList.toggle("asc", isSorted && state.sortDir === 1);
    th.setAttribute("aria-sort", isSorted ? (state.sortDir === 1 ? "ascending" : "descending") : "none");
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
  const monthLabel = state.selectedMonth ? monthLabelOf(state.selectedMonth) : "all time";
  document.getElementById("dest-title").textContent = `Referred Destination Breakdown for ${monthLabel}`;

  // only transferred concerns have a destination; DONE and free-text notes are not offices
  const rows = state.records.filter(r => r.status === "Transferred" && (!state.selectedMonth || r.monthKey === state.selectedMonth));
  const groups = new Map();
  let notes = 0, missing = 0;
  for (const r of rows) {
    const d = cleanDestination(r.destination);
    if (!d) { missing++; continue; }
    if (d.split(" ").length >= 5) { notes++; continue; }
    const k = d.toLowerCase().replace(/[^a-z0-9]/g, "");
    const g = groups.get(k) || { count: 0, spellings: new Map() };
    g.count++; g.spellings.set(d, (g.spellings.get(d) || 0) + 1);
    groups.set(k, g);
  }
  const entries = [...groups.values()]
    .map(g => [[...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], g.count])
    .sort((a, b) => b[1] - a[1]);
  const wrap = document.getElementById("dest-chips");
  let html = entries.map(([dest, count]) => `<span class="chip chip-static">${escapeHTML(dest)} <span class="count">${count}</span></span>`).join("");
  if (notes) html += `<span class="chip chip-static">Free-text notes <span class="count">${notes}</span></span>`;
  if (missing) html += `<span class="chip chip-static chip-gap" title="Transferred, but no destination was recorded">No destination recorded <span class="count">${missing}</span></span>`;
  wrap.innerHTML = rows.length
    ? html + `<p class="card-hint dest-note">Counts transferred concerns only (${rows.length} in ${escapeHTML(monthLabel)}). \u201cDONE\u201d entries and notes on resolved concerns are not destinations. Spellings that differ only by case or punctuation are merged.</p>`
    : emptyNote("No transferred concerns for this month.");
}

/* =========================================================================
   EXPORT
   ========================================================================= */
function exportFilteredCSV() {
  const rows = getFilteredRows();
  const headers = ["Queue Number", "Identified Theme", "Enrollment Sub-topic", "Description", "Concern Status", "Resolution", "Referred To", "Follow-up Flags"];
  // a leading = + - @ would be run as a formula when the file is opened in a spreadsheet
  const csvEscape = v => {
    let t = (v || "").toString();
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(",")].concat(
    rows.map(r => [r.queueNumber, r.theme, r.subTheme, r.description, r.status, r.resolution, r.destination, r.flags.map(id => FLAGS.find(f => f.id === id).label).join("; ")].map(csvEscape).join(","))
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
  renderTrend();
  renderFollowUp();
  renderThemeChart();
  renderSubTopics();
  renderFilterChips();
  renderAuditTable();
  renderDestinationTable();
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function wireEvents() {
  document.getElementById("month-select").addEventListener("change", e => {
    state.selectedMonth = e.target.value;
    state.page = 1;
    state.activeThemeBar = null;
    state.themeFilter.clear();
    state.subFilter.clear();
    state.flagFilter = null;
    renderMonthStats();
    renderTrend();
    renderFollowUp();
    renderThemeChart();
    renderSubTopics();
    renderFilterChips();
    renderAuditTable();
    renderDestinationTable();
  });

  document.getElementById("search-input").addEventListener("input", e => {
    state.searchText = e.target.value.trim();
    state.page = 1;
    renderAuditTable();
  });

  document.getElementById("clear-filters-btn").addEventListener("click", () => {
    state.statusFilter.clear();
    state.themeFilter.clear();
    state.subFilter.clear();
    state.flagFilter = null;
    state.activeThemeBar = null;
    state.searchText = "";
    document.getElementById("search-input").value = "";
    state.page = 1;
    renderFilterChips();
    renderThemeChart();
    renderAuditTable();
  });

  document.getElementById("export-btn").addEventListener("click", exportFilteredCSV);

  function sortByKey(key) {
    if (state.sortKey === key) state.sortDir *= -1;
    else { state.sortKey = key; state.sortDir = 1; }
    renderAuditTable();
  }
  document.getElementById("audit-thead-row").addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]");
    if (th) sortByKey(th.dataset.sort);
  });
  document.getElementById("audit-thead-row").addEventListener("keydown", e => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortByKey(th.dataset.sort); }
  });

  [["audit-toggle", "audit-body"], ["dest-toggle", "dest-body"]].forEach(([toggleId, bodyId]) => {
    document.getElementById(toggleId).addEventListener("click", () => {
      const btn = document.getElementById(toggleId);
      const body = document.getElementById(bodyId);
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
    });
  });

}

/* =========================================================================
   AUTH GUARD (client-side gate only -- see README for the security caveat)
   ========================================================================= */
const AUTH_STORAGE_KEY = "ccs-vo-auth-user";

/* =========================================================================
   INIT
   ========================================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const user = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!user) {
    location.replace("index.html");
    return;
  }
  document.getElementById("signed-in-as").textContent = `Signed in as ${user}`;
  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    location.href = "index.html";
  });
  loadData();
  setInterval(() => loadData({ silent: true }), AUTO_REFRESH_MS);
  try {
    wireEvents();
  } catch (err) {
    console.error("wireEvents failed:", err);
  }
});

})();
