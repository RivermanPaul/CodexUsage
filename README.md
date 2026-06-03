# Codex Usage

Phone-first static PWA for tracking weekly Codex usage against a daily budget.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Use on iPhone

Host this folder on any HTTPS static host, open the URL in Safari, then choose **Share > Add to Home Screen**.

The app stores the weekly reset timestamp, current remaining percentage, and daily allowance in browser local storage. No account or server is required.

The day count uses local calendar days in the reset week, so the EOD target matches normal daily planning instead of shifting at the exact reset hour.

## Mac sync bookmarklet

Open `https://rivermanpaul.github.io/CodexUsage/bookmarklet.html` on Mac and drag **Sync Codex Usage** to the bookmarks bar.

Start the local Mac helper:

```bash
node scripts/sync-server.mjs
```

When ChatGPT's usage menu or Codex analytics page is visible, click the bookmarklet. It reads the visible weekly remaining percentage and sends only that percent to the local helper. The helper updates `usage.json`, commits, and pushes through the Mac's existing `gh`/git credentials.

The phone app fetches `usage.json` on refresh, so no ChatGPT credentials or long-lived tokens live in the public web app.
