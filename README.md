# CCS Virtual Office Dashboard

A static, client-side dashboard for the CCS Virtual Office queue log. It fetches
the published Google Sheet as CSV directly in the visitor's browser — no backend,
no build step, no API key.

## Pages

- `index.html` — login.
- `dashboard.html` — Operations Dashboard (`assets/app.js`), the queue-log data
  covered above.
- `evaluation.html` — Evaluation Analytics (`assets/evaluation.js`), client
  satisfaction survey data: hero KPIs (all-time + monthly), a dynamically
  generated analyst-style insight callout, a stacked-bar breakdown of the four
  service-quality dimensions (Response Time, Staff Knowledge, Staff Courtesy,
  Ease of Resolution), a satisfaction-distribution chart, a resolution-status
  breakdown, a shuffleable random sample of real client comments ("Voices from
  the Community" — comments that are just "None"/"N/A"/"-" are filtered out of
  the sample), and a collapsible full feedback list. All of it is month-scoped
  via the same "Select Month to Review" pattern as the Operations Dashboard.

## How it works

- `assets/app.js` and `assets/evaluation.js` each fetch their own published CSV
  from the `CSV_URL` constant at the top of the file on load (and every 60s
  after), parse it, and render. `assets/app.js` additionally classifies each
  operations entry into a theme (Enrollment & Enlistment, Practicum &
  Internship, Thesis & Capstone, etc.) by matching keywords in the "Brief
  Description of Concern or Inquiry" column, since that sheet has no theme
  column of its own.
- The month shown throughout both dashboards is derived from the date embedded
  in each response's queue number (format `YYYYMMDD-N`).
- Everything else (filters, search, sorting, pagination, CSV export, comment
  shuffling, dark mode) runs entirely client-side against the parsed data — no
  dependencies, no CDN.

## Login gate

Two separate pages:

- `index.html` — the login screen. `assets/auth.js` checks the entered
  credentials against salted SHA-256 hashes in `assets/users.json` (no
  plaintext passwords stored) and, on success, stores the username in
  `localStorage` and redirects to `dashboard.html`. If already logged in, it
  redirects straight to the dashboard instead of showing the form again.
- `dashboard.html` and `evaluation.html` — both guarded the same way. A
  blocking inline script in each page's `<head>` checks `localStorage` before
  the page renders and redirects back to `index.html` immediately if there's
  no session, so there's no flash of content for a logged-out visitor. Each
  page's own script (`assets/app.js` / `assets/evaluation.js`) repeats that
  same check on load (belt-and-suspenders) and wires the "Log out" button,
  which clears the session and sends the user back to `index.html`.

**This is a deterrent, not real access control.** Anyone can view either
page's source or `users.json`, and — more importantly — the dashboard's data
source is a Google Sheet published "to the web," so the raw CSV at `CSV_URL`
is already fetchable by anyone with that URL regardless of this login. If the
data needs genuine protection, that means either restricting the sheet's
publish/sharing settings, or moving off static GitHub Pages hosting to
something with real server-side auth.

To add/change a user, generate a random salt and `sha256(salt + password)`,
then add `{ "username", "salt", "hash" }` to `assets/users.json`.

## Updating the data source

Edit `CSV_URL` at the top of `assets/app.js` (Operations) or
`assets/evaluation.js` (Evaluation) if either published sheet URL ever changes
(File → Share → Publish to web → CSV, in Google Sheets).

## Running locally

It's static HTML/CSS/JS — just serve the folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploying with GitHub Pages

1. Repo Settings → Pages → Build and deployment → Deploy from a branch.
2. Pick this branch and `/ (root)` as the folder.
3. Save — GitHub will publish `index.html` at the generated Pages URL.
