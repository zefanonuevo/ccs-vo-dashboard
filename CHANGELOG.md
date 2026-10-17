# Changelog

Every version is a git tag, so any of them can be opened, downloaded or restored.
See [Versions and restoring](README.md#versions-and-restoring) in the README.

The version shown in the footer of every page comes from `assets/shell.js`
(`VERSION`). Change it together with this file when you cut a new version.

## 2.2.0 — Enrollment sub-topics

Enrollment & Enlistment is about two thirds of all queries (1,313 of 2,037), so one
bar hid most of what clients ask about. It is now split into sub-topics, worked out
from the wording of the real queries.

### Added
- **Inside Enrollment & Enlistment** card on the Operations Dashboard: the
  sub-topics for the selected month, with a click-to-filter drill-down.
- **Enrollment Sub-topic** filter in the audit log, a sub-topic line under the
  topic in the table, and an *Enrollment Sub-topic* column in the CSV export.
- Knowledge Base: a sub-topic tag on each precedent, and a sub-topic filter that
  appears when the Enrollment topic is selected.
- The eight sub-topics: Enlistment Errors & Final Submit, Add / Drop & Changes,
  Manual Enlistment, Special Classes, Petitions & Residency, Class Availability &
  Sections, Enrollment Status & Late Enrollment, Electives & Course Selection, and
  Other Enlistment Questions (about 14% of Enrollment).

### Changed
- The topic classifier now lives in one file, `assets/classify.js`, used by both
  the Dashboard and the Knowledge Base. They had separate identical copies.
- The Knowledge Base no longer shows "Routed to: DONE"; DONE is not an office.

## 2.1.0 — Analyst review

A review of the dashboard's data and charts against the live sheets. Numbers were
checked against an independent export of both sheets.

### Added
- **Monthly Volume** chart: queries per month, click a month to review it. The
  current month is marked *MTD* (month to date) with a hatched bar. A table view
  sits under the chart.
- **Records Needing Follow-up** card, and a matching **Follow-up Flag** filter in the
  audit log. Five flags: status missing or still "New"; In Progress but a
  resolution is written; In Progress for 14+ days; Resolved without a resolution
  note; Transferred without a destination.
- Evaluation: **response coverage** (share of logged queries that have a survey
  response, from the operations sheet), a **95% range** under satisfaction, small
  and very small sample notes, and a **Closed in the Log, Open for the Client**
  card listing queue numbers where the client said "still in progress" but the
  operations log says Resolved. A table view for the service-quality bars.
- Version label and a link to this changelog in every page footer.

### Changed
- The month comparison uses the previous **calendar** month. While a month is
  still running it is compared over the same days ("vs Sep 1–17"), and a small
  base is flagged. Volume changes use neutral arrows, not green and red.
- **Referred Destination Breakdown** counts transferred concerns only. "DONE"
  and free-text notes are no longer counted as offices, spellings that differ by
  case or punctuation are merged, and transfers with no destination are shown.
- Evaluation insights no longer call a dimension the "standout" or "soft spot"
  when the gap is under 5 points, and they say when ratings sit at the ceiling or
  when few clients answered. Repeat responses for one queue number are removed.
- Colours: topic colours are numbered in the colour-blind-checked order (same
  hues; Thesis & Capstone is a lighter violet). The rating scale is now blue,
  gray and orange/red instead of green to red. Satisfaction badges use dark text.
- In Progress counts show how many have been open 14+ days (amber).
- CSV export is spreadsheet-safe (cells starting with `= + - @` are escaped) and
  includes the follow-up flags.

### Fixed
- Sorting by Queue Number was alphabetical (`…-10` before `…-2`). It is now numeric.
- The "% Excellent" label on the quality bars ran past the edge of its card.

## 2.0.1 — Mobile fixes
- The Resources dropdown is no longer covered by the pinned tab bar.
- A "scroll sideways" hint above the wide tables.
- Text-valued stat tiles are smaller and wrap by word.

## 2.0.0 — macOS-style redesign on the shared design system
- Loads the shared `ccs-design` tokens (green, white, black) used by the Task Tracker
  and the Grant Support System. System font, frosted header, segmented tabs.
- System / Light / Dark theme switch (replaces the single dark-mode button).
- Header scrolls away on phones; the tab strip stays pinned.
- Phone fixes: stat tiles shrink, chart labels sit above bars, larger touch targets.
- No more width animation on bars, hover lifts, or pulsing "Live" dot.

## 1.0.0 — Original dashboard
Operations Dashboard, Evaluation Analytics and Knowledge Base on the Google Sheets
data, behind a client-side login, with the design-system consolidation completed
(`57cda34`).
