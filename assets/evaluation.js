(() => {
"use strict";

/* =========================================================================
   CONFIG
   ========================================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRKrE6d21W4_HIq9KqObaeawyzKjr9-Tg0AuuFeH5CMg3lo4a9_oTbBnVv0MTZ03de9FukynIUbk0_J/pub?gid=0&single=true&output=csv";
// the operations log, used for response coverage and to cross-check "resolved" answers
const OPS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBdVhjxW5btyVGFw5H2HS52JhLDkACu1EY7un_57jtWcgVmYVFPyTj647pRv6fKyw33ID3YIzcoozK/pub?gid=0&single=true&output=csv";
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

const EMPTY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M20 7H4a1 1 0 0 0-1 1v3l2.4 6h13.2L21 11V8a1 1 0 0 0-1-1ZM8 4h8l2 3H6l2-3Zm-.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" fill="currentColor"/></svg>';
function emptyNote(text) { return `<p class="empty-note">${EMPTY_ICON}${text}</p>`; }

/* =========================================================================
   STATE
   ========================================================================= */
const state = {
  records: [],
  months: [],
  selectedMonth: null,
  shuffleSeed: 0,
  ops: null,          // { total, byMonth: Map, statusByQueue: Map } when the operations log loaded
  dupes: 0,           // repeat responses for the same queue number that were dropped
  unreadableQueue: 0, // responses whose queue number is not YYYYMMDD-N
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
   DATA QUALITY: duplicates, unreadable queue numbers, operations cross-check
   ========================================================================= */
const QUEUE_RE = /^\d{8}-\d+$/;

// Keep the latest response per queue number. Responses with an unreadable queue
// number cannot be matched or de-duplicated, so they stay (all-time figures only).
function dedupeRecords(records) {
  const lastIndex = new Map();
  records.forEach((r, i) => { if (QUEUE_RE.test(r.queueNumber)) lastIndex.set(r.queueNumber, i); });
  const kept = records.filter((r, i) => !QUEUE_RE.test(r.queueNumber) || lastIndex.get(r.queueNumber) === i);
  state.dupes = records.length - kept.length;
  state.unreadableQueue = kept.filter(r => !QUEUE_RE.test(r.queueNumber)).length;
  return kept;
}

function normalizeOpsStatus(raw) {
  const s = (raw || "").trim().toLowerCase();
  if (s.startsWith("resolved")) return "Resolved";
  if (s.startsWith("transferred")) return "Transferred";
  return "In Progress";
}

async function loadOps() {
  try {
    const res = await fetch(OPS_CSV_URL + "&cachebust=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const { rows } = parseCSV(await res.text());
    const byMonth = new Map(), statusByQueue = new Map();
    let total = 0;
    for (const r of rows) {
      const q = (r["Queue Number"] || "").trim();
      if (!q) continue;
      total++;
      statusByQueue.set(q, normalizeOpsStatus(r["Concern Status"]));
      const d = parseQueueDate(q);
      if (d) { const k = monthKeyOf(d); byMonth.set(k, (byMonth.get(k) || 0) + 1); }
    }
    state.ops = { total, byMonth, statusByQueue };
  } catch (err) {
    console.warn("Operations log not available; response coverage is hidden.", err);
    state.ops = null;
  }
}

// 95% Wilson interval for a share, in percent
function wilson(pos, n) {
  if (!n) return null;
  const z = 1.96, p = pos / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, centre - half) * 100, Math.min(1, centre + half) * 100];
}
function rangeText(pos, n) {
  const w = wilson(pos, n);
  return w ? `95% range ${Math.round(w[0])}\u2013${Math.round(w[1])}%` : "";
}

// share of the month's queries that answered the survey (null when the log is unavailable)
function coverage(month) {
  if (!state.ops) return null;
  const answered = state.records.filter(r => QUEUE_RE.test(r.queueNumber) && (!month || r.monthKey === month)).length;
  const logged = month ? (state.ops.byMonth.get(month) || 0) : state.ops.total;
  return logged ? { answered, logged, pct: pct(answered, logged) } : null;
}

// clients who say the issue is still in progress while the log already shows Resolved
function resolutionGap() {
  if (!state.ops) return [];
  return state.records.filter(r =>
    QUEUE_RE.test(r.queueNumber) && r.resolved.toLowerCase().includes("progress") &&
    state.ops.statusByQueue.get(r.queueNumber) === "Resolved");
}

/* =========================================================================
   DATA LOADING
   ========================================================================= */
const SKELETON_CONTAINER_IDS = ["overall-stats", "month-stats", "quality-bars", "satisfaction-chart"];
function setLoadingSkeleton(on) {
  SKELETON_CONTAINER_IDS.forEach(id => {
    document.getElementById(id)?.classList.toggle("is-loading", on);
  });
}

async function loadData({ silent = false } = {}) {
  const statusEl = document.getElementById("load-status");
  const liveBadge = document.getElementById("live-badge");
  if (!silent) {
    statusEl.hidden = false;
    statusEl.className = "load-status loading";
    statusEl.textContent = "Fetching latest evaluation data…";
    if (state.records.length === 0) setLoadingSkeleton(true);
  }
  try {
    const url = CSV_URL + (CSV_URL.includes("?") ? "&" : "?") + "cachebust=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet request failed (HTTP ${res.status})`);
    const text = await res.text();
    const { rows } = parseCSV(text);
    if (rows.length === 0) throw new Error("The published sheet returned no rows.");
    state.records = dedupeRecords(buildRecords(rows));
    await loadOps();

    const monthKeys = Array.from(new Set(state.records.filter(r => r.monthKey).map(r => r.monthKey))).sort();
    state.months = monthKeys.map(key => ({ key, label: monthLabelOf(key) }));
    if (!state.selectedMonth || !monthKeys.includes(state.selectedMonth)) {
      state.selectedMonth = monthKeys[monthKeys.length - 1] || null;
    }

    statusEl.hidden = true;
    document.getElementById("last-updated").textContent = `${state.records.length} survey responses`;
    liveBadge.hidden = false;
    setLoadingSkeleton(false);
    renderAll();
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.className = "load-status error";
    statusEl.textContent = `Couldn't load the evaluation sheet (${err.message}). Retrying automatically every minute.`;
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
    positive,
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
  const cov = coverage(null);
  const c = document.getElementById("overall-stats");
  renderStatTile(c, "responses", fmtNum(s.total), cov ? `${cov.pct}% of ${fmtNum(cov.logged)} queries` : "All-time record count", "flat");
  renderStatTile(c, "positive", s.satTotal ? `${s.positivePct}%` : "\u2014", s.satTotal ? `of ${fmtNum(s.satTotal)} \u00B7 ${rangeText(s.positive, s.satTotal)}` : "No data", "flat");
  renderStatTile(c, "avgrating", s.avg != null ? s.avg.toFixed(1) + " / 5" : "\u2014", "across 4 service dimensions", "flat");
  renderStatTile(c, "resolved", s.resolvedTotal ? `${s.resolvedPct}%` : "\u2014", s.resolvedTotal ? `of ${fmtNum(s.resolvedTotal)} respondents` : "No data", "flat");
}

function renderMonthStats() {
  const key = state.selectedMonth;
  const c = document.getElementById("month-stats");
  const noteEl = document.getElementById("month-sample-note");
  if (!key) {
    ["responses","positive","avgrating","resolved"].forEach(s => renderStatTile(c, s, "\u2014", "No data", "flat"));
    noteEl.textContent = "";
    return;
  }
  const rows = monthRecords(key);
  const s = computeStats(rows);
  const cov = coverage(key);
  renderStatTile(c, "responses", fmtNum(s.total), cov ? `${cov.pct}% of ${fmtNum(cov.logged)} queries` : "", "flat");
  renderStatTile(c, "positive", s.satTotal ? `${s.positivePct}%` : "\u2014", s.satTotal ? rangeText(s.positive, s.satTotal) : "", "flat");
  renderStatTile(c, "avgrating", s.avg != null ? s.avg.toFixed(1) + " / 5" : "\u2014", "", "flat");
  renderStatTile(c, "resolved", s.resolvedTotal ? `${s.resolvedPct}%` : "\u2014", "", "flat");
  const size = s.total < 10 ? "Very small sample" : s.total < 30 ? "Small sample" : "";
  const parts = [`Based on ${s.total} response${s.total === 1 ? "" : "s"} this month${cov ? `, ${cov.pct}% of the ${fmtNum(cov.logged)} queries logged` : ""}.`];
  if (size) parts.push(`${size}: the range shown for satisfaction is wide, so read single percentages loosely.`);
  if (cov && cov.pct < 10) parts.push("Few clients answered, so these results may not represent everyone who used the office.");
  noteEl.textContent = parts.join(" ");
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
  const cov = coverage(null);
  const bullets = [];

  bullets.push(`<strong>${s.positivePct}%</strong> of respondents were Very Satisfied or Satisfied (${rangeText(s.positive, s.satTotal)}, n=${fmtNum(s.satTotal)}, average <strong>${s.avg != null ? s.avg.toFixed(1) : "\u2014"}/5</strong> across the four dimensions).`
    + (cov ? ` Only <strong>${cov.pct}%</strong> of the ${fmtNum(cov.logged)} logged queries have a survey response, so this is the view of clients who chose to answer.` : ""));

  // coverage trend: first vs latest month that has at least 50 logged queries
  if (state.ops) {
    const months = state.months.map(m => ({ key: m.key, c: coverage(m.key) })).filter(x => x.c && x.c.logged >= 50);
    if (months.length >= 2) {
      const a = months[0], z = months[months.length - 1];
      if (z.c.pct < a.c.pct * 0.5) {
        bullets.push(`<li class="flag">Response coverage fell from <strong>${a.c.pct}%</strong> in ${monthLabelOf(a.key)} to <strong>${z.c.pct}%</strong> in ${monthLabelOf(z.key)}. The survey is reaching fewer clients over time; a prompt at the end of each session would help.</li>`);
      }
    }
  }

  const metricStats = RATING_METRICS.map(m => {
    const vals = state.records.map(r => r[m.key]).filter(Boolean);
    return { label: m.label, excellentPct: pct(vals.filter(v => v === "Excellent").length, vals.length), n: vals.length };
  }).filter(m => m.n > 0);
  if (metricStats.length > 1) {
    const sorted = [...metricStats].sort((a, b) => b.excellentPct - a.excellentPct);
    const hi = sorted[0], lo = sorted[sorted.length - 1];
    if (hi.excellentPct - lo.excellentPct >= 5) {
      bullets.push(`<strong>${escapeHTML(lo.label)}</strong> has the fewest Excellent ratings (${lo.excellentPct}%), against ${hi.excellentPct}% for ${escapeHTML(hi.label)}. It is the first place to look for improvement.`);
    } else {
      bullets.push(`All four dimensions are rated Excellent by ${lo.excellentPct}\u2013${hi.excellentPct}% of respondents. The gaps are too small to rank one above another.`);
    }
    const allTop = state.records.filter(r => RATING_METRICS.every(m => r[m.key] === "Excellent")).length;
    if (s.avg != null && s.avg >= 4.5 && allTop / s.total >= 0.5) {
      bullets.push(`${fmtNum(allTop)} of ${fmtNum(s.total)} responses gave Excellent on all four dimensions. Ratings sit at the ceiling, so this survey can reveal problems but cannot separate good service from great.`);
    }
  }

  if (s.resolvedTotal) {
    const vals = state.records.map(r => r.resolved).filter(Boolean);
    const stillPct = pct(vals.filter(v => v.toLowerCase().includes("progress")).length, vals.length);
    const transPct = pct(vals.filter(v => v.toLowerCase().includes("transfer")).length, vals.length);
    bullets.push(`<li${stillPct > 25 ? ' class="flag"' : ""}><strong>${s.resolvedPct}%</strong> said their issue was completely resolved; <strong>${stillPct}%</strong> said it was still in progress and <strong>${transPct}%</strong> said it was transferred.</li>`);
  }

  const gap = resolutionGap();
  if (state.ops && state.records.length) {
    bullets.push(gap.length
      ? `<li class="flag"><strong>${fmtNum(gap.length)}</strong> clients (${pct(gap.length, state.records.length)}% of respondents) said their issue was still in progress, while the operations log marks the same queue as Resolved. These may have been closed too early. The list is in the next card.</li>`
      : `No client answered \u201cstill in progress\u201d on a queue that the log shows as Resolved.`);
  }

  const notes = [];
  if (state.dupes) notes.push(`${state.dupes} repeat response${state.dupes === 1 ? " was" : "s were"} removed (one per queue number is kept)`);
  if (state.unreadableQueue) notes.push(`${state.unreadableQueue} response${state.unreadableQueue === 1 ? " has" : "s have"} an unreadable queue number and count in all-time totals only`);
  if (notes.length) bullets.push(`<span class="muted-note">Data notes: ${notes.join("; ")}.</span>`);

  const totalComments = state.records.filter(r => r.comment).length;
  const meaningfulComments = state.records.filter(r => r.hasMeaningfulComment).length;
  if (totalComments) {
    bullets.push(`${meaningfulComments} of ${totalComments} written comments contained specific feedback beyond a simple "none". Browse them in Voices from the Community below.`);
  }

  list.innerHTML = bullets.map(b => b.startsWith("<li") ? b : `<li>${b}</li>`).join("");
}

/* =========================================================================
   RENDER: closed in the log, open for the client
   ========================================================================= */
function renderGapCard() {
  const card = document.getElementById("gap-card");
  const gap = resolutionGap();
  if (!state.ops || !gap.length) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById("gap-summary").textContent =
    `${gap.length} queue number${gap.length === 1 ? "" : "s"}: the client said \u201cstill in progress\u201d, the operations log says Resolved. Re-checking these is the quickest way to find concerns that were closed early.`;
  const byMonth = new Map();
  gap.forEach(r => { const k = r.monthKey || "unknown"; (byMonth.get(k) || byMonth.set(k, []).get(k)).push(r.queueNumber); });
  document.getElementById("gap-list").innerHTML = [...byMonth.entries()].sort().map(([k, qs]) =>
    `<div class="gap-month"><strong>${k === "unknown" ? "No readable date" : monthLabelOf(k)}</strong> <span class="count">${qs.length}</span><div class="gap-queues">${qs.map(q => `<code>${escapeHTML(q)}</code>`).join("")}</div></div>`
  ).join("");
}

/* =========================================================================
   RENDER: service quality stacked bars
   ========================================================================= */
function renderQualityBars() {
  const key = state.selectedMonth;
  const rows = monthRecords(key);
  const label = key ? monthLabelOf(key) : "—";
  document.getElementById("quality-title").textContent = `Service Quality Breakdown for ${label}`;

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
        <span class="stacked-bar-summary">${excellentPct}%<span class="wide"> Excellent</span></span>
      </div>`;
  }).join("");

  document.getElementById("quality-table-body").innerHTML = RATING_METRICS.map(m => {
    const vals = rows.map(r => r[m.key]).filter(Boolean);
    const counts = countValues(vals);
    return `<tr><td>${escapeHTML(m.label)}</td>${RATING_ORDER.map(l => `<td class="num">${counts.get(l) || 0}</td>`).join("")}<td class="num">${vals.length}</td></tr>`;
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
  document.getElementById("satisfaction-title").textContent = `How Clients Rated Their Experience in ${label}`;

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
  }).join("") || emptyNote("No responses recorded for this month.");

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
  document.getElementById("resolution-title").textContent = `Was the Issue Resolved? (${label})`;

  const vals = rows.map(r => r.resolved).filter(Boolean);
  const counts = countValues(vals);
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const wrap = document.getElementById("resolution-chips");
  wrap.innerHTML = entries.length
    ? entries.map(([v, count]) => `<span class="chip chip-static"><span class="dot" style="background:${resolutionColor(v)}"></span>${escapeHTML(v)} <span class="count">${count}</span></span>`).join("")
    : emptyNote("No responses recorded for this month.");
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
  return `<span class="sat-badge" style="background:color-mix(in srgb, ${color} 16%, transparent)"><span class="dot" style="background:${color}"></span>${escapeHTML(satisfaction)}</span>`;
}

function renderComments() {
  const pool = meaningfulPool();
  document.getElementById("quote-subtitle").textContent = pool.length
    ? `A random sample of what clients told us in their own words — showing ${Math.min(SHUFFLE_COUNT, pool.length)} of ${pool.length} real comments.`
    : "No written comments yet.";

  const grid = document.getElementById("quote-grid");
  if (pool.length === 0) {
    grid.innerHTML = emptyNote("No written comments yet.");
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
  document.getElementById("feedback-title").textContent = `View All Feedback Comments (${rows.length})`;
  const tbody = document.getElementById("feedback-tbody");
  tbody.innerHTML = rows.length
    ? rows.map(r => `
      <tr>
        <td>${escapeHTML(r.queueNumber)}</td>
        <td>${satBadge(r.satisfaction) || "—"}</td>
        <td class="desc-cell"><div class="clamp">${escapeHTML(r.comment)}</div>${r.comment.length > 140 ? '<button class="expand-btn" data-expand>Show more</button>' : ""}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="padding:24px;"><p class="empty-note" style="justify-content:center;">${EMPTY_ICON}No comments yet.</p></td></tr>`;
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
  renderGapCard();
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
