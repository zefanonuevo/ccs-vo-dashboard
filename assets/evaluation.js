(() => {
"use strict";

/* =========================================================================
   CONFIG
   ========================================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRKrE6d21W4_HIq9KqObaeawyzKjr9-Tg0AuuFeH5CMg3lo4a9_oTbBnVv0MTZ03de9FukynIUbk0_J/pub?gid=0&single=true&output=csv";
const AUTH_STORAGE_KEY = "ccs-vo-auth-user";
const AUTO_REFRESH_MS = 60000;
const SHUFFLE_COUNT = 6;

const QUEUE_COL = "Please input your assigned  queue number";
const SAT_COL = "How satisfied were you with your experience today?";
const RESPONSE_TIME_COL = "Response Time";
const STAFF_KNOWLEDGE_COL = "Staff Knowledge";
const STAFF_COURTESY_COL = "Staff Courtesy";
const EASE_COL = "Ease of Resolution";
const RESOLVED_COL = "Was your issue or question fully resolved today?";
const COMMENT_COL = "Is there anything else you’d like us to know? (e.g., What did we do well? What could we improve?)";

const RATING_METRICS = [
  { key: "responseTime", col: RESPONSE_TIME_COL, label: "Response Time" },
  { key: "staffKnowledge", col: STAFF_KNOWLEDGE_COL, label: "Staff Knowledge" },
  { key: "staffCourtesy", col: STAFF_COURTESY_COL, label: "Staff Courtesy" },
  { key: "easeOfResolution", col: EASE_COL, label: "Ease of Resolution" },
];

const RATING_ORDER = ["Excellent", "Good", "Fair", "Poor", "Very Poor"];
const RATING_SCORE = { "Excellent": 5, "Good": 4, "Fair": 3, "Poor": 2, "Very Poor": 1 };
const RATING_COLOR = { "Excellent": "var(--rate-5)", "Good": "var(--rate-4)", "Fair": "var(--rate-3)", "Poor": "var(--rate-2)", "Very Poor": "var(--rate-1)" };

const SAT_ORDER = ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very Dissatisfied"];
const SAT_SCORE = { "Very Satisfied": 5, "Satisfied": 4, "Neutral": 3, "Dissatisfied": 2, "Very Dissatisfied": 1 };
const SAT_COLOR = { "Very Satisfied": "var(--rate-5)", "Satisfied": "var(--rate-4)", "Neutral": "var(--rate-3)", "Dissatisfied": "var(--rate-2)", "Very Dissatisfied": "var(--rate-1)" };

const TRIVIAL_COMMENTS = new Set(["none", "n/a", "na", "not applicable", "-", "nil", "no", "nope", "wala", "none.", "n/a."]);

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* =========================================================================
   STATE
   ========================================================================= */
const state = {
  records: [],
  months: [],
  selectedMonth: null,
  shuffleSeed: 0,
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
   TRANSFORM
   ========================================================================= */
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

function isMeaningfulComment(text) {
  if (!text) return false;
  const norm = text.trim().toLowerCase().replace(/[.!:,]+$/, "");
  return norm.length > 0 && !TRIVIAL_COMMENTS.has(norm);
}

function buildRecords(rawRows) {
  return rawRows
    .filter(r => (r[QUEUE_COL] || "").trim() !== "")
    .map(r => {
      const queueNumber = (r[QUEUE_COL] || "").trim().replace(/^#/, "");
      const date = parseQueueDate(queueNumber);
      const comment = (r[COMMENT_COL] || "").trim();
      return {
        queueNumber,
        satisfaction: (r[SAT_COL] || "").trim(),
        responseTime: (r[RESPONSE_TIME_COL] || "").trim(),
        staffKnowledge: (r[STAFF_KNOWLEDGE_COL] || "").trim(),
        staffCourtesy: (r[STAFF_COURTESY_COL] || "").trim(),
        easeOfResolution: (r[EASE_COL] || "").trim(),
        resolved: (r[RESOLVED_COL] || "").trim(),
        comment,
        hasMeaningfulComment: isMeaningfulComment(comment),
        date,
        monthKey: date ? monthKeyOf(date) : null,
      };
    });
}

/* =========================================================================
   DATA LOADING
   ========================================================================= */
async function loadData({ silent = false } = {}) {
  const statusEl = document.getElementById("load-status");
  const liveBadge = document.getElementById("live-badge");
  if (!silent) {
    statusEl.hidden = false;
    statusEl.className = "load-status loading";
    statusEl.textContent = "Fetching latest evaluation data…";
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
    document.getElementById("last-updated").textContent = `${state.records.length} survey responses`;
    liveBadge.hidden = false;
    renderAll();
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.className = "load-status error";
    statusEl.textContent = `Couldn't load the evaluation sheet (${err.message}). Retrying automatically every minute.`;
    document.getElementById("last-updated").textContent = "Data unavailable";
    liveBadge.hidden = true;
  }
}

/* =========================================================================
   HELPERS
   ========================================================================= */
function fmtNum(n) { return n.toLocaleString("en-US"); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
function countValues(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}
function escapeHTML(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHTML(s).replace(/`/g, "&#96;"); }

function avgScore(values, scoreMap) {
  const scored = values.map(v => scoreMap[v]).filter(v => v != null);
  if (scored.length === 0) return null;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

function monthRecords(month) {
  return state.records.filter(r => !month || r.monthKey === month);
}

/* =========================================================================
   COMPUTED STATS
   ========================================================================= */
function computeStats(rows) {
  const total = rows.length;
  const satVals = rows.map(r => r.satisfaction).filter(Boolean);
  const positive = satVals.filter(v => v === "Very Satisfied" || v === "Satisfied").length;
  const allRatingVals = [];
  RATING_METRICS.forEach(m => rows.forEach(r => { if (r[m.key]) allRatingVals.push(r[m.key]); }));
  const avg = avgScore(allRatingVals, RATING_SCORE);
  const resolvedVals = rows.map(r => r.resolved).filter(Boolean);
  const resolvedYes = resolvedVals.filter(v => v.toLowerCase().startsWith("yes")).length;
  return {
    total,
    satTotal: satVals.length,
    positivePct: pct(positive, satVals.length),
    avg,
    resolvedTotal: resolvedVals.length,
    resolvedPct: pct(resolvedYes, resolvedVals.length),
  };
}

/* =========================================================================
   RENDER: hero stat tiles
   ========================================================================= */
function renderStatTile(container, statName, valueText, deltaHTML, deltaClass) {
  const tile = container.querySelector(`[data-stat="${statName}"]`);
  if (!tile) return;
  tile.querySelector(".stat-value").textContent = valueText;
  const deltaEl = tile.querySelector(".stat-delta");
  deltaEl.innerHTML = deltaHTML || "";
  deltaEl.className = "stat-delta" + (deltaClass ? " " + deltaClass : "");
}

function renderOverallStats() {
  const s = computeStats(state.records);
  const c = document.getElementById("overall-stats");
  renderStatTile(c, "responses", fmtNum(s.total), "All-time record count", "flat");
  renderStatTile(c, "positive", s.satTotal ? `${s.positivePct}%` : "—", s.satTotal ? `of ${fmtNum(s.satTotal)} respondents` : "No data", "up");
  renderStatTile(c, "avgrating", s.avg != null ? s.avg.toFixed(1) + " / 5" : "—", "across 4 service dimensions", "up");
  renderStatTile(c, "resolved", s.resolvedTotal ? `${s.resolvedPct}%` : "—", s.resolvedTotal ? `of ${fmtNum(s.resolvedTotal)} respondents` : "No data", "flat");
}

function renderMonthStats() {
  const key = state.selectedMonth;
  const c = document.getElementById("month-stats");
  const noteEl = document.getElementById("month-sample-note");
  if (!key) {
    ["responses","positive","avgrating","resolved"].forEach(s => renderStatTile(c, s, "—", "No data", "flat"));
    noteEl.textContent = "";
    return;
  }
  const rows = monthRecords(key);
  const s = computeStats(rows);
  renderStatTile(c, "responses", fmtNum(s.total), "", "flat");
  renderStatTile(c, "positive", s.satTotal ? `${s.positivePct}%` : "—", "", "up");
  renderStatTile(c, "avgrating", s.avg != null ? s.avg.toFixed(1) + " / 5" : "—", "", "up");
  renderStatTile(c, "resolved", s.resolvedTotal ? `${s.resolvedPct}%` : "—", "", "flat");
  noteEl.textContent = s.total < 10
    ? `Based on ${s.total} response${s.total === 1 ? "" : "s"} this month — small sample, interpret with care.`
    : `Based on ${s.total} responses this month.`;
}

function renderMonthSelect() {
  const sel = document.getElementById("month-select");
  sel.innerHTML = state.months.map(m =>
    `<option value="${m.key}" ${m.key === state.selectedMonth ? "selected" : ""}>${m.label}</option>`
  ).join("");
}

/* =========================================================================
   RENDER: analyst insight callout
   ========================================================================= */
function renderInsightCard() {
  const list = document.getElementById("insight-list");
  const s = computeStats(state.records);
  if (s.total === 0) {
    list.innerHTML = "<li>Not enough responses yet to draw conclusions.</li>";
    return;
  }

  const metricStats = RATING_METRICS.map(m => {
    const vals = state.records.map(r => r[m.key]).filter(Boolean);
    const excellentPct = pct(vals.filter(v => v === "Excellent").length, vals.length);
    return { label: m.label, avg: avgScore(vals, RATING_SCORE), excellentPct, n: vals.length };
  }).filter(m => m.n > 0);

  const bullets = [];

  bullets.push(`<strong>${s.positivePct}%</strong> of respondents rated their experience Very Satisfied or Satisfied (average <strong>${s.avg != null ? s.avg.toFixed(1) : "—"}/5</strong> across all service dimensions, n=${fmtNum(s.total)}) — a strong signal the virtual office model is landing well with clients.`);

  if (metricStats.length) {
    const strongest = [...metricStats].sort((a, b) => b.avg - a.avg)[0];
    const weakest = [...metricStats].sort((a, b) => a.avg - b.avg)[0];
    bullets.push(`<strong>${escapeHTML(strongest.label)}</strong> is the standout dimension, with ${strongest.excellentPct}% of respondents rating it Excellent.`);
    if (weakest.label !== strongest.label) {
      bullets.push(`<strong>${escapeHTML(weakest.label)}</strong> is the comparative soft spot at ${weakest.excellentPct}% Excellent — still high, but the clearest opportunity to tighten up.`);
    }
  }

  if (s.resolvedTotal) {
    const rows = state.records.map(r => r.resolved).filter(Boolean);
    const inProgressPct = pct(rows.filter(v => v.toLowerCase().includes("progress")).length, rows.length);
    const flagClass = inProgressPct > 25 ? ' class="flag"' : "";
    bullets.push(`<li${flagClass}><strong>${s.resolvedPct}%</strong> of issues were resolved in the same visit; <strong>${inProgressPct}%</strong> were still in progress when the client filled out the form — likely cases needing coordination with another office (see the Operations Dashboard's Destination Breakdown).</li>`);
  }

  const totalComments = state.records.filter(r => r.comment).length;
  const meaningfulComments = state.records.filter(r => r.hasMeaningfulComment).length;
  if (totalComments) {
    bullets.push(`${meaningfulComments} of ${totalComments} written comments contained specific feedback beyond a simple "none" — browse them in Voices from the Community below.`);
  }

  list.innerHTML = bullets.map(b => b.startsWith("<li") ? b : `<li>${b}</li>`).join("");
}

/* =========================================================================
   RENDER: service quality stacked bars
   ========================================================================= */
function renderQualityBars() {
  const key = state.selectedMonth;
  const rows = monthRecords(key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("quality-title").textContent = `🎯 Service Quality Breakdown for ${label}`;

  const wrap = document.getElementById("quality-bars");
  wrap.innerHTML = RATING_METRICS.map(m => {
    const vals = rows.map(r => r[m.key]).filter(Boolean);
    const n = vals.length;
    const counts = countValues(vals);
    const segs = RATING_ORDER.map(level => {
      const count = counts.get(level) || 0;
      const widthPct = n ? (count / n) * 100 : 0;
      return { level, count, widthPct };
    }).filter(s => s.count > 0);
    const excellentPct = n ? pct(counts.get("Excellent") || 0, n) : 0;
    return `
      <div class="stacked-bar-row">
        <span class="stacked-bar-label">${escapeHTML(m.label)}<span class="n">n=${n}</span></span>
        <span class="stacked-bar-track">
          ${segs.map(s => `<span class="stacked-bar-seg" style="width:${s.widthPct}%; background:${RATING_COLOR[s.level]}" title="${escapeAttr(s.level)}: ${s.count} (${pct(s.count, n)}%)"></span>`).join("")}
        </span>
        <span class="stacked-bar-summary">${excellentPct}% Excellent</span>
      </div>`;
  }).join("");

  const legend = document.getElementById("quality-legend");
  legend.innerHTML = RATING_ORDER.map(level =>
    `<span class="quality-legend-item"><span class="dot" style="background:${RATING_COLOR[level]}"></span>${level}</span>`
  ).join("");
}

/* =========================================================================
   RENDER: satisfaction distribution (month-scoped)
   ========================================================================= */
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

function renderSatisfactionChart() {
  const key = state.selectedMonth;
  const rows = monthRecords(key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("satisfaction-title").textContent = `😊 How Clients Rated Their Experience in ${label}`;

  const satVals = rows.map(r => r.satisfaction).filter(Boolean);
  const total = satVals.length;
  const counts = countValues(satVals);
  const max = Math.max(1, ...SAT_ORDER.map(level => counts.get(level) || 0));

  const chart = document.getElementById("satisfaction-chart");
  chart.innerHTML = SAT_ORDER.map(level => {
    const count = counts.get(level) || 0;
    const widthPct = Math.max((count / max) * 100, count > 0 ? 2 : 0);
    return `
      <div class="chart-row">
        <span class="bar-label">${level}</span>
        <span class="bar-track">
          <span class="bar-fill" style="width:${widthPct}%; background:${SAT_COLOR[level]}"
                data-tooltip="${level}: ${count} (${pct(count, total)}%)"></span>
        </span>
        <span class="bar-value">${count}</span>
      </div>`;
  }).join("") || `<p class="card-hint">No responses recorded for this month.</p>`;

  chart.querySelectorAll(".bar-fill").forEach(bar => {
    bar.addEventListener("mouseenter", showBarTooltip);
    bar.addEventListener("mousemove", showBarTooltip);
    bar.addEventListener("mouseleave", hideBarTooltip);
  });
}

/* =========================================================================
   RENDER: resolution status chips (month-scoped)
   ========================================================================= */
function resolutionColor(value) {
  const v = value.toLowerCase();
  if (v.startsWith("yes")) return "var(--good)";
  if (v.includes("progress")) return "var(--warning)";
  if (v.includes("transfer")) return "var(--series-1)";
  return "var(--series-other)";
}

function renderResolutionChips() {
  const key = state.selectedMonth;
  const rows = monthRecords(key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("resolution-title").textContent = `✅ Was the Issue Resolved? (${label})`;

  const vals = rows.map(r => r.resolved).filter(Boolean);
  const counts = countValues(vals);
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const wrap = document.getElementById("resolution-chips");
  wrap.innerHTML = entries.length
    ? entries.map(([v, count]) => `<span class="chip chip-static"><span class="dot" style="background:${resolutionColor(v)}"></span>${escapeHTML(v)} <span class="count">${count}</span></span>`).join("")
    : `<p class="card-hint" style="margin:0;">No responses recorded for this month.</p>`;
}

/* =========================================================================
   RENDER: random comments ("Voices from the Community")
   ========================================================================= */
function meaningfulPool() {
  return state.records.filter(r => r.hasMeaningfulComment);
}

function shuffledSample(arr, count, seed) {
  const copy = [...arr];
  let s = seed || 1;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function satBadge(satisfaction) {
  if (!satisfaction) return "";
  const color = SAT_COLOR[satisfaction] || "var(--series-other)";
  return `<span class="sat-badge" style="background:color-mix(in srgb, ${color} 16%, transparent); color:${color}"><span class="dot" style="background:${color}"></span>${escapeHTML(satisfaction)}</span>`;
}

function renderComments() {
  const pool = meaningfulPool();
  document.getElementById("quote-subtitle").textContent = pool.length
    ? `A random sample of what clients told us in their own words — showing ${Math.min(SHUFFLE_COUNT, pool.length)} of ${pool.length} real comments.`
    : "No written comments yet.";

  const grid = document.getElementById("quote-grid");
  if (pool.length === 0) {
    grid.innerHTML = `<p class="card-hint">No written comments yet.</p>`;
    return;
  }
  const sample = shuffledSample(pool, SHUFFLE_COUNT, Date.now() + state.shuffleSeed);
  grid.innerHTML = sample.map(r => `
    <div class="quote-card">
      <span class="quote-mark">&ldquo;</span>
      <p class="quote-text">${escapeHTML(r.comment)}</p>
      <div class="quote-footer">
        ${satBadge(r.satisfaction)}
        <span class="quote-date">${r.date ? r.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
      </div>
    </div>`).join("");
}

/* =========================================================================
   RENDER: full feedback table
   ========================================================================= */
function renderFeedbackTable() {
  const rows = state.records.filter(r => r.comment).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  document.getElementById("feedback-title").textContent = `💬 View All Feedback Comments (${rows.length})`;
  const tbody = document.getElementById("feedback-tbody");
  tbody.innerHTML = rows.length
    ? rows.map(r => `
      <tr>
        <td>${escapeHTML(r.queueNumber)}</td>
        <td>${satBadge(r.satisfaction) || "—"}</td>
        <td class="desc-cell"><div class="clamp">${escapeHTML(r.comment)}</div>${r.comment.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:24px;">No comments yet.</td></tr>`;
  tbody.querySelectorAll("[data-expand]").forEach(btn => {
    btn.addEventListener("click", () => {
      const clamp = btn.previousElementSibling;
      clamp.classList.toggle("expanded");
      btn.textContent = clamp.classList.contains("expanded") ? "Show less" : "Show more";
    });
  });
}

/* =========================================================================
   RENDER ALL
   ========================================================================= */
function renderAll() {
  renderOverallStats();
  renderMonthSelect();
  renderMonthStats();
  renderInsightCard();
  renderQualityBars();
  renderSatisfactionChart();
  renderResolutionChips();
  renderComments();
  renderFeedbackTable();
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function wireEvents() {
  document.getElementById("month-select").addEventListener("change", e => {
    state.selectedMonth = e.target.value;
    renderMonthStats();
    renderQualityBars();
    renderSatisfactionChart();
    renderResolutionChips();
  });

  document.getElementById("shuffle-btn").addEventListener("click", () => {
    state.shuffleSeed++;
    renderComments();
  });

  document.getElementById("feedback-toggle").addEventListener("click", () => {
    const btn = document.getElementById("feedback-toggle");
    const body = document.getElementById("feedback-body");
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
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
