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

## Login gate

`index.html` shows a login screen before the dashboard; credentials are checked
client-side in `assets/app.js` against salted SHA-256 hashes in
`assets/users.json` (no plaintext passwords are stored). A session is remembered
in `localStorage` until the user clicks "Log out".

**This is a deterrent, not real access control.** Anyone can view this page's
source or `users.json`, and — more importantly — the dashboard's data source is
a Google Sheet published "to the web," so the raw CSV at `CSV_URL` is already
fetchable by anyone with that URL regardless of this login. If the data needs
genuine protection, that means either restricting the sheet's publish/sharing
settings, or moving off static GitHub Pages hosting to something with real
server-side auth.

To add/change a user, generate a random salt and `sha256(salt + password)`,
then add `{ "username", "salt", "hash" }` to `assets/users.json`.

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
