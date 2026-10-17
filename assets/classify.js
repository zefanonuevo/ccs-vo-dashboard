/* Shared topic classifier, used by the Operations Dashboard and the Knowledge Base.
   One copy, so the two pages can never disagree about which topic a query belongs to.

   1. THEME_DEFS: first matching topic wins, so the order matters (specific topics first).
   2. SUB_DEFS: Enrollment & Enlistment is about two thirds of all queries, so it is split
      into sub-topics, also first match wins. Only Enrollment queries get a sub-topic.
   3. cleanDestination: the "Referred to Another Office" column also holds the word DONE
      and free-text notes. DONE is a workflow marker, not an office. */
(function () {
"use strict";

const THEME_DEFS = [
  { name: "Thesis & Capstone", color: "var(--series-7)",
    patterns: [/\bthesis\b/, /\bcapstone\b/, /\bdissertation\b/, /\bdefense\b/, /\bproposal\b/, /\bccs999/, /writing\s*[123]\b/] },
  { name: "Practicum & Internship", color: "var(--series-3)",
    patterns: [/\bpracticum\b/, /\bojt\b/, /\bintern(ship)?\b/, /\bprct/, /\bprc-/, /\bprcie/, /\bprcne/, /\bprcis/, /\bmoa\b/, /\biom\b/, /\bhte\b/] },
  { name: "Shifting & Program Change", color: "var(--series-8)",
    patterns: [/\bshift(ing|ed|s)?\b/, /change\s+of\s+program/] },
  { name: "Grades & Academic Standing", color: "var(--series-5)",
    patterns: [/\bgrade[sd]?\b/, /\bgwa\b/, /\bfail(ed|ing)?\b/, /\bretake\b/, /academic\s+(standing|probation)/, /dean.?s\s+list/, /\bcog\b/, /\btor\b/] },
  { name: "Leave of Absence / Returnee", color: "var(--series-2)",
    patterns: [/\bloa\b/, /leave of absence/, /\breturnee\b/] },
  { name: "Fees & Payment", color: "var(--series-4)",
    patterns: [/\bfee[s]?\b/, /\bpayment\b/, /\bmisc\b/, /\btuition\b/, /\brefund\b/, /\bassessment\b/, /\bbilling\b/] },
  { name: "Curriculum & Degree Program", color: "var(--series-6)",
    patterns: [/\bcurriculum\b/, /course mapping/, /\bderf\b/, /study plan/, /\bflowchart\b/, /\bminor\b/, /program eligib/] },
  { name: "Enrollment & Enlistment", color: "var(--series-1)",
    patterns: [/\benlist/, /\benroll/, /archer/, /\bah\b/, /add.?drop/, /\badd(ing|ed)?\b/, /\bdrop(ping|ped)?\b/, /\bsection[s]?\b/, /\bslot[s]?\b/, /\bconfirm/, /\bclass(es)?\b/, /\bcourse[s]?\b/, /\boffering\b/, /\bresidency\b/, /\belective[s]?\b/, /special class/, /\bcredit(ing|ed)?\b/, /\bpetition/, /\bsubject[s]?\b/] },
];
const OTHER_THEME = { name: "General Inquiries / Others", color: "var(--series-other)" };
const ENROLLMENT = "Enrollment & Enlistment";

const SUB_DEFS = [
  { name: "Special Classes, Petitions & Residency",
    patterns: [/special\s+class/, /\bpetition/, /\bresidency\b/, /class\s+application/, /\btutorial/] },
  { name: "Manual Enlistment",
    patterns: [/manual(ly)?\b/, /on\s+(my|his|her|their)\s+behalf/, /\btag(ged|ging)?\b/] },
  { name: "Enlistment Errors & Final Submit",
    patterns: [/final[\s-]*submit/, /clicked\s+final/, /submit\s+button/, /unable\s+to\s+(enlist|add|enroll|select)/,
      /(cannot|can.?t|unable\s+to)\s+(enlist|add|drop|select|enroll|see|find|access\s+the\s+enlistment)/,
      /not\s+(showing|appearing|displayed|reflect)/, /missing\s+course/,
      /enlistment\s+(tab|page|error|issue|problem|button)/, /\bpending\b/, /\bstuck\b/, /\berror\b/, /\bglitch/] },
  { name: "Add / Drop & Changes",
    patterns: [/add.?drop/, /\badd(ing|ed)?\b/, /\bdrop(ping|ped)?\b/, /\bwithdraw/, /change\s+(of\s+)?(section|schedule|course)/] },
  { name: "Class Availability & Sections",
    patterns: [/\bsection[s]?\b/, /\bslot[s]?\b/, /\bfull\b/, /\boffering\b/, /not\s+offered/, /\bavailable\b/, /\bavailability\b/, /\bschedule/, /waitlist/, /\bcapacity\b/, /\bclosed\b/] },
  { name: "Electives & Course Selection",
    patterns: [/\belective[s]?\b/, /course\s+(selection|crediting|finder|mapping)/, /\bcredit(ing|ed)?\b/, /cross.?enroll/, /\bselect(ing)?\b/] },
  { name: "Enrollment Status & Late Enrollment",
    patterns: [/late\s+enrol/, /\benrol(l|lment|led)\b/, /\bconfirm/, /\bactivation\b/, /\bstatus\b/] },
];
const OTHER_SUB = "Other Enlistment Questions";

function classifyTheme(description) {
  const d = (description || "").toLowerCase();
  for (const t of THEME_DEFS) for (const p of t.patterns) if (p.test(d)) return t;
  return OTHER_THEME;
}
function classifySub(description) {
  const d = (description || "").toLowerCase();
  for (const s of SUB_DEFS) for (const p of s.patterns) if (p.test(d)) return s.name;
  return OTHER_SUB;
}
function themeColor(name) {
  const t = THEME_DEFS.find(t => t.name === name);
  return t ? t.color : OTHER_THEME.color;
}
function cleanDestination(raw) {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s || /^done\.?$/i.test(s)) return "";
  return s;
}

window.VO_CLASSIFY = { THEME_DEFS, OTHER_THEME, ENROLLMENT, SUB_DEFS, OTHER_SUB, classifyTheme, classifySub, themeColor, cleanDestination };
})();
