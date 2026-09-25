# Scorpion Office MLB Playoff Pool

Small office playoff bracket pool hosted as a static page inside `JordanHartman-ai/scorpion-office-events`.

## Why this stack

- GitHub Pages: static front end, zero server maintenance.
- Google Apps Script: tiny public API with the important security checks server-side.
- Google Sheet: easy historical record and commissioner visibility.
- MLB Stats API: game schedule and probable pitchers with no key.

Railway is intentionally not needed for this size of pool.

## What is built

- 12-team MLB postseason bracket with round chaining.
- Wild Card → Division Series → LCS → World Series.
- 11 scored picks + World Series games tiebreaker.
- Chalk and random autofill.
- Participant edit PINs; the sheet stores only a SHA-256 hash using a secret pepper.
- Server-side lock deadline plus commissioner lock/unlock override.
- Other participants' picks hidden until lock.
- Commissioner results entry.
- Post-lock leaderboard and pick-popularity cards.
- MLB schedule/probable-pitcher panel.
- No account/login requirement.

## Final setup

### 1. Create a dedicated Google Sheet

Create a blank Google Sheet solely for this pool. Copy its spreadsheet ID from the URL.

### 2. Create a standalone Apps Script project

In Apps Script, create a new project and paste `apps-script/Code.gs` into the editor.

In **Project Settings → Script Properties**, add:

- `SHEET_ID` = the spreadsheet ID
- `ADMIN_PASSWORD` = a commissioner password
- `PIN_PEPPER` = a long random secret string

Do not put these values in GitHub.

Run `setupPool()` once from the Apps Script editor and authorize it. This creates:

- `Picks`
- `Results`
- `Config`

In `Config`, set `lockAt` to the final deadline as an ISO timestamp, for example:

`2026-09-29T12:00:00-07:00`

Leave `locked` as `false`; the timestamp will still cause the server to lock automatically.

### 3. Deploy the Apps Script Web App

Deploy → New deployment → Web app:

- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL.

### 4. Connect the GitHub page

Edit `config.js` and paste the Apps Script `/exec` URL into `API_URL`.

### 5. Confirm final seeds

The team/seeding list in `config.js` is deliberately isolated so it can be updated in one file after the regular season standings are final.

Before sharing the office link, confirm the six AL and six NL seeds against MLB's official postseason bracket. The bracket logic assumes the standard 2026 format:

- No. 3 vs No. 6
- No. 4 vs No. 5
- No. 1 and No. 2 receive Wild Card byes
- No. 1 faces the 4/5 winner
- No. 2 faces the 3/6 winner

## Scoring

Each correct series winner is 1 point, 11 possible total.

The World Series games prediction is stored as a tiebreaker. The UI currently shows total correct picks; if the commissioner enters `wsGames` in the Results row after the World Series, equal scores sort by closest tiebreaker.

## Security notes

This is an office game, not a high-security application, but the meaningful controls are server-side:

- Lock checks happen in Apps Script, not only the browser.
- Commissioner password and PIN pepper live only in Script Properties.
- Pre-lock `getPicks` returns only the named participant's row and requires that row's PIN.
- Post-lock `getPicks` removes PIN hashes before returning pool data.
- User names are rendered as text/escaped in the UI.
- The Sheet and Apps Script project should be dedicated to this pool.

## Files

- `index.html` – UI shell
- `styles.css` – responsive styling
- `app.js` – bracket, submission, dashboard and admin logic
- `config.js` – public configuration/seeds/API URL
- `apps-script/Code.gs` – Google Apps Script API
