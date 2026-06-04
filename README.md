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
./scripts/start-interactive-helper.command
```

When ChatGPT's usage menu or Codex analytics page is visible, click the bookmarklet. It reads the visible weekly remaining percentage and weekly reset date, then sends only those values to the local helper. The helper updates `usage.json`, commits, and pushes through the Mac's existing `gh`/git credentials.

The phone app fetches `usage.json` on refresh, so no ChatGPT credentials or long-lived tokens live in the public web app.

The visible refresh status shows both the time this device last checked successfully and the source data timestamp, so stale published data is easy to spot even when the weekly percentage does not change.

## Mac polling

The helper also exposes `GET /poll`. It takes a Mac screenshot, OCRs the visible ChatGPT usage menu or Codex analytics page with Tesseract, extracts the weekly remaining percentage and reset date, then updates, commits, and pushes `usage.json`.

The helper is started in a `tmux` session so it can keep running while still being able to capture the logged-in user's screen. A normal LaunchAgent can serve HTTP, but it cannot reliably capture the display for OCR.

On Mac, tapping refresh tries `http://127.0.0.1:8787/poll` before reading the published value. Other devices only poll a Mac helper after a helper URL is stored locally on that device, for example through a private URL fragment:

```text
https://rivermanpaul.github.io/CodexUsage/#helper=http%3A%2F%2FMac-host.local%3A8787%2Fpoll&token=local-device-token
```

The token is stored in that browser's local storage and is not part of the public repo.

With a configured helper, tapping refresh on a phone briefly navigates to the Mac helper. After the Mac OCR sync succeeds, the helper redirects back to the app with the fresh weekly percentage.
