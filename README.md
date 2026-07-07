# CCS Virtual Office Dashboard

A static, client-side dashboard for the CCS Virtual Office queue log. It fetches
the published Google Sheet as CSV directly in the visitor's browser — no backend,
no build step, no API key.

## How it works

- `assets/app.js` fetches the published CSV from the URL in `CSV_URL` on load
  (and whenever you click refresh), parses it, and classifies each entry into a
  theme (Enrollment & Enlistment, Practicum & Internship, Thesis & Capstone,
  etc.) by matching keywords in the "Brief Description of Concern or Inquiry"
  column, since the sheet itself has no theme column.
- The month shown throughout the dashboard is derived from the date embedded in
  each `Queue Number` (format `YYYYMMDD-N`).
- Everything else (filters, search, sorting, pagination, CSV export, dark mode)
  runs entirely client-side against the parsed data — no dependencies, no CDN.

## Updating the data source

Edit `CSV_URL` at the top of `assets/app.js` if the published sheet URL ever
changes (File → Share → Publish to web → CSV, in Google Sheets).

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
