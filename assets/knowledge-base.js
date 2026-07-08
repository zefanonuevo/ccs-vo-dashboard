(() => {
"use strict";

/* =========================================================================
   CONFIG
   ========================================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBdVhjxW5btyVGFw5H2HS52JhLDkACu1EY7un_57jtWcgVmYVFPyTj647pRv6fKyw33ID3YIzcoozK/pub?gid=0&single=true&output=csv";
const PAGE_SIZE = 10;
const QUICK_TOPIC_COUNT = 6;

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

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const TRIVIAL_RESOLUTIONS = new Set(["none", "n/a", "na", "not applicable", "-", "nil", "tbd", "pending", "n/a."]);

/* =========================================================================
   STATE
   ========================================================================= */
const state = {
  entries: [],
  searchText: "",
  themeFilter: new Set(),
  page: 1,
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
  return "In Progress";
}

function parseQueueDate(queueNumber) {
  const m = /^(\d{4})(\d{2})(\d{2})-\d+$/.exec((queueNumber || "").trim());
  if (!m) return null;
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, day);
}

function monthLabelOf(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function isMeaningfulResolution(text) {
  const t = (text || "").trim();
  if (!t) return false;
  return !TRIVIAL_RESOLUTIONS.has(t.toLowerCase());
}

function buildEntries(rawRows) {
  return rawRows
    .map(r => {
      const status = normalizeStatus(r["Concern Status"]);
      const description = (r["Brief Description of Concern or Inquiry"] || "").trim();
      const resolution = (r["Resolution"] || "").trim();
      const date = parseQueueDate(r["Queue Number"]);
      const theme = classifyTheme(description);
      return {
        queueNumber: r["Queue Number"] || "(no ID)",
        description,
        resolution,
        status,
        destination: (r["Referred to Another Office"] || "").trim(),
        date,
        theme: theme.name,
      };
    })
    .filter(e => (e.status === "Resolved" || e.status === "Transferred")
      && e.description !== ""
      && isMeaningfulResolution(e.resolution));
}

/* =========================================================================
   DATA LOADING
   ========================================================================= */
const AUTO_REFRESH_MS = 60000;

async function loadData({ silent = false } = {}) {
  const statusEl = document.getElementById("load-status");
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
    state.entries = buildEntries(rows);

    statusEl.hidden = true;
    document.getElementById("last-updated").textContent = `${state.entries.length} indexed precedents`;
    document.getElementById("live-badge").hidden = false;
    renderAll();
  } catch (err) {
    console.error(err);
    statusEl.hidden = false;
    statusEl.className = "load-status error";
    statusEl.textContent = `Couldn't load the spreadsheet (${err.message}). Retrying automatically every minute.`;
    document.getElementById("last-updated").textContent = "Data unavailable";
    document.getElementById("live-badge").hidden = true;
  }
}

/* =========================================================================
   HELPERS
   ========================================================================= */
function fmtNum(n) { return n.toLocaleString("en-US"); }

function escapeHTML(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHTML(s).replace(/`/g, "&#96;"); }

function countBy(records, key) {
  const m = new Map();
  for (const r of records) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
}

/* =========================================================================
   RENDER: coverage stats
   ========================================================================= */
function renderStats() {
  const c = document.getElementById("kb-stats");
  const total = state.entries.length;
  const themeCounts = countBy(state.entries, "theme");
  const topEntry = Array.from(themeCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  c.querySelector('[data-stat="total"] .stat-value').textContent = fmtNum(total);
  c.querySelector('[data-stat="total"] .stat-delta').textContent = "Resolved & transferred concerns with a recorded resolution";

  c.querySelector('[data-stat="themes"] .stat-value').textContent = fmtNum(themeCounts.size);
  c.querySelector('[data-stat="themes"] .stat-delta').textContent = "Distinct topic categories";

  c.querySelector('[data-stat="topTheme"] .stat-value').textContent = topEntry ? topEntry[0] : "—";
  c.querySelector('[data-stat="topTheme"] .stat-delta').textContent = topEntry ? `${fmtNum(topEntry[1])} precedents on record` : "No data";

  c.querySelector('[data-stat="updated"] .stat-value').textContent = "Operations Log";
  c.querySelector('[data-stat="updated"] .stat-delta').textContent = "Auto-synced from the queue log every minute";
}

/* =========================================================================
   RENDER: quick-topic cards ("Frequently Handled Concerns")
   ========================================================================= */
function renderQuickTopics() {
  const themeCounts = countBy(state.entries, "theme");
  const topThemes = Array.from(themeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, QUICK_TOPIC_COUNT);

  const grid = document.getElementById("kb-quick-grid");
  grid.innerHTML = topThemes.map(([theme, count]) => {
    const candidates = state.entries.filter(e => e.theme === theme)
      .sort((a, b) => (b.resolution.length - a.resolution.length));
    const sample = candidates[0];
    return `
      <div class="quote-card kb-quick-card" data-jump-theme="${escapeAttr(theme)}" role="button" tabindex="0">
        <div class="theme-tag"><span class="dot" style="background:${themeColor(theme)}"></span>${escapeHTML(theme)} <span class="count">${count}</span></div>
        <p class="quote-text"><strong>Client asked:</strong> ${escapeHTML(truncate(sample.description, 130))}</p>
        <p class="quote-text"><strong>How it was handled:</strong> ${escapeHTML(truncate(sample.resolution, 130))}</p>
        <div class="quote-footer"><span class="quote-date">See all ${count} precedents &rarr;</span></div>
      </div>`;
  }).join("") || `<p class="card-hint" style="margin:0;">No precedents indexed yet.</p>`;

  grid.querySelectorAll("[data-jump-theme]").forEach(card => {
    const jump = () => {
      const theme = card.dataset.jumpTheme;
      state.themeFilter.clear();
      state.themeFilter.add(theme);
      state.page = 1;
      renderThemeChips();
      renderResults();
      document.getElementById("kb-browse").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    card.addEventListener("click", jump);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); } });
  });
}

function truncate(s, n) {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
}

/* =========================================================================
   RENDER: theme filter chips
   ========================================================================= */
function renderThemeChips() {
  const themeCounts = countBy(state.entries, "theme");
  const allThemeNames = [...THEME_DEFS.map(t => t.name), OTHER_THEME.name];
  const wrap = document.getElementById("kb-theme-chips");
  wrap.innerHTML = allThemeNames.filter(t => themeCounts.get(t)).map(t => {
    const count = themeCounts.get(t) || 0;
    const selected = state.themeFilter.has(t);
    return `<button type="button" class="chip ${selected ? "selected" : ""}" data-theme="${escapeAttr(t)}">
      <span class="dot" style="background:${themeColor(t)}"></span>${escapeHTML(t)} <span class="count">${count}</span>
    </button>`;
  }).join("");
  wrap.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const t = chip.dataset.theme;
      state.themeFilter.has(t) ? state.themeFilter.delete(t) : state.themeFilter.add(t);
      state.page = 1;
      renderThemeChips();
      renderResults();
    });
  });
}

/* =========================================================================
   RENDER: search results (Q&A cards + pagination)
   ========================================================================= */
function getFilteredEntries() {
  let rows = state.entries;
  if (state.themeFilter.size) rows = rows.filter(e => state.themeFilter.has(e.theme));
  if (state.searchText) {
    const q = state.searchText.toLowerCase();
    rows = rows.filter(e => e.description.toLowerCase().includes(q) || e.resolution.toLowerCase().includes(q));
  }
  return [...rows].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

function renderResults() {
  const rows = getFilteredEntries();
  document.getElementById("kb-count").textContent =
    `Showing ${fmtNum(rows.length)} ${rows.length === 1 ? "precedent" : "precedents"} matching current filters`;

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const list = document.getElementById("kb-results");
  if (pageRows.length === 0) {
    list.innerHTML = `<p class="card-hint" style="margin:0;">No precedents match these filters. Try a different keyword or clear the topic filter.</p>`;
  } else {
    list.innerHTML = pageRows.map(e => {
      const statusClass = e.status === "Resolved" ? "resolved" : "transferred";
      const ref = `${escapeHTML(e.queueNumber)}${e.date ? ` · ${monthLabelOf(e.date)}` : ""}`;
      return `
      <article class="kb-card">
        <div class="kb-card-head">
          <span class="theme-tag"><span class="dot" style="background:${themeColor(e.theme)}"></span>${escapeHTML(e.theme)}</span>
          <span class="status-tag ${statusClass}">${e.status}</span>
          ${e.destination ? `<span class="chip chip-static">Routed to: ${escapeHTML(e.destination)}</span>` : ""}
          <span class="kb-ref">Ref: ${ref}</span>
        </div>
        <div class="kb-q"><span class="kb-qa-label">Client asked</span><div>${escapeHTML(e.description)}</div></div>
        <div class="kb-a"><span class="kb-qa-label">How it was handled</span><div>${escapeHTML(e.resolution)}</div></div>
      </article>`;
    }).join("");
  }

  renderPagination(rows.length);
}

function renderPagination(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const wrap = document.getElementById("kb-pagination");
  let html = `<button class="page-btn" id="kb-page-prev" ${state.page <= 1 ? "disabled" : ""}>‹ Prev</button>`;
  const windowSize = 5;
  let startPage = Math.max(1, state.page - Math.floor(windowSize / 2));
  let endPage = Math.min(totalPages, startPage + windowSize - 1);
  startPage = Math.max(1, endPage - windowSize + 1);
  for (let p = startPage; p <= endPage; p++) {
    html += `<button class="page-btn ${p === state.page ? "active" : ""}" data-page="${p}">${p}</button>`;
  }
  html += `<button class="page-btn" id="kb-page-next" ${state.page >= totalPages ? "disabled" : ""}>Next ›</button>`;
  wrap.innerHTML = html;
  wrap.querySelector("#kb-page-prev")?.addEventListener("click", () => { state.page--; renderResults(); });
  wrap.querySelector("#kb-page-next")?.addEventListener("click", () => { state.page++; renderResults(); });
  wrap.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => { state.page = +btn.dataset.page; renderResults(); });
  });
}

/* =========================================================================
   RENDER ALL
   ========================================================================= */
function renderAll() {
  renderStats();
  renderQuickTopics();
  renderThemeChips();
  renderResults();
}

/* =========================================================================
   EVENT WIRING
   ========================================================================= */
function wireEvents() {
  document.getElementById("kb-search-input").addEventListener("input", e => {
    state.searchText = e.target.value.trim();
    state.page = 1;
    renderResults();
  });

  document.getElementById("kb-clear-btn").addEventListener("click", () => {
    state.themeFilter.clear();
    state.searchText = "";
    document.getElementById("kb-search-input").value = "";
    state.page = 1;
    renderThemeChips();
    renderResults();
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
