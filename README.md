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
