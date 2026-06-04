#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, unlink, writeFile } from "node:fs/promises";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const usagePath = join(rootDir, "usage.json");
const port = Number(process.env.CODEX_USAGE_SYNC_PORT || 8787);
const host = process.env.CODEX_USAGE_SYNC_HOST || "127.0.0.1";
const tesseractCommand = process.env.CODEX_USAGE_TESSERACT || "/opt/homebrew/bin/tesseract";
const cliclickCommand = process.env.CODEX_USAGE_CLICLICK || "/opt/homebrew/bin/cliclick";
const syncTokenPath = process.env.CODEX_USAGE_SYNC_TOKEN_FILE || join(homedir(), "Library", "Application Support", "CodexUsage", "sync-token");
const syncToken = loadSyncToken();
const revealSource = process.env.CODEX_USAGE_REVEAL_SOURCE !== "0";
const codexCaptureBounds = parseCodexCaptureBounds(process.env.CODEX_USAGE_CODEX_BOUNDS || "116,147,1280,820");
const chromeCaptureBounds = parseCodexCaptureBounds(process.env.CODEX_USAGE_CHROME_BOUNDS || "116,147,1800,1100");
const chromeWeeklyRegion = parseScreenRegion(process.env.CODEX_USAGE_CHROME_WEEKLY_REGION || "1120,420,640,190");
const chromeUsageUrl = process.env.CODEX_USAGE_CHROME_URL || "https://chatgpt.com/codex/cloud/settings/analytics#usage";
const dryRun = process.env.CODEX_USAGE_DRY_RUN === "1";

function loadSyncToken() {
  if (process.env.CODEX_USAGE_SYNC_TOKEN) return process.env.CODEX_USAGE_SYNC_TOKEN.trim();

  try {
    return readFileSync(syncTokenPath, "utf8").trim();
  } catch (_error) {
    return "";
  }
}

function parseCodexCaptureBounds(value) {
  const fallback = { x: 116, y: 147, width: 1280, height: 820 };
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return fallback;

  return {
    x: Math.round(parts[0]),
    y: Math.round(parts[1]),
    width: Math.max(640, Math.round(parts[2])),
    height: Math.max(480, Math.round(parts[3]))
  };
}

function parseScreenRegion(value) {
  const parts = String(value || "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  return {
    x: Math.round(parts[0]),
    y: Math.round(parts[1]),
    width: Math.max(1, Math.round(parts[2])),
    height: Math.max(1, Math.round(parts[3]))
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function normalizePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
}

function toLocalInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function normalizeResetAt(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const reset = new Date(value);
  if (Number.isNaN(reset.getTime())) return "";
  return toLocalInputValue(reset);
}

function normalizeSource(value) {
  const source = String(value || "mac-helper").trim();
  if (!/^[a-z0-9_-]{1,32}$/i.test(source)) return "mac-helper";
  return source;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n");
}

function findWeeklyPercent(text) {
  const normalized = normalizeText(text);
  const patterns = [
    /Weekly usage limit[\s\S]{0,220}?(\d{1,3}(?:\.\d+)?)\s*%\s*remaining/i,
    /Usage remaining[\s\S]{0,420}?Weekl\w*\s+(\d{1,3}(?:\.\d+)?)\s*%/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const percent = normalizePercent(match[1]);
      if (percent !== null) return percent;
    }
  }

  return null;
}

function findChromeAnalyticsWeeklyPercent(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/Weekly usage limit[\s\S]{0,180}?(\d{1,3}(?:\.\d+)?)\s*%\s*remaining/i);
  if (!match) return null;
  return normalizePercent(match[1]);
}

function monthIndex(value) {
  const months = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11
  };
  return months[String(value || "").slice(0, 3).toLowerCase()];
}

function parseMeridiemTime(time, meridiem) {
  if (!time) return null;
  const parts = String(time).split(":");
  let hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const marker = String(meridiem || "").toLowerCase();
  if (marker === "pm" && hour < 12) hour += 12;
  if (marker === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

function sameResetDate(first, second) {
  const firstReset = normalizeResetAt(first);
  const secondReset = normalizeResetAt(second);
  return Boolean(firstReset && secondReset && firstReset.slice(0, 10) === secondReset.slice(0, 10));
}

function normalizeResetCandidate(candidate, previousResetAt = "") {
  if (candidate && typeof candidate === "object") {
    const resetAt = normalizeResetAt(candidate.resetAt);
    if (!resetAt) return "";
    if (!candidate.exactTime && sameResetDate(resetAt, previousResetAt)) {
      return normalizeResetAt(previousResetAt);
    }
    return resetAt;
  }

  return normalizeResetAt(candidate);
}

function resetFromMatch(match, now = new Date()) {
  const month = monthIndex(match[1]);
  const day = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";

  const year = match[3] ? Number(match[3]) : now.getFullYear();
  const parsedTime = parseMeridiemTime(match[4], match[5]);
  const exactTime = Boolean(parsedTime);
  const hour = parsedTime ? parsedTime.hour : now.getHours();
  const minute = parsedTime ? parsedTime.minute : now.getMinutes();
  let reset = new Date(year, month, day, hour, minute);

  if (!match[3] && reset.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
    reset = new Date(year + 1, month, day, hour, minute);
  }

  return { resetAt: toLocalInputValue(reset), exactTime };
}

function findWeeklyReset(text, now = new Date()) {
  const normalized = normalizeText(text);
  const patterns = [
    /Usage remaining[\s\S]{0,520}?Weekl\w*\s+\d{1,3}(?:\.\d+)?\s*%\s+([A-Z][a-z]{2})\s*(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}:\d{2})\s*([AP]M))?/i,
    /Weekly usage limit[\s\S]{0,320}?Resets\s+([A-Z][a-z]{2})\s*(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}:\d{2})\s*([AP]M))?/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const reset = resetFromMatch(match, now);
      if (reset) return reset;
    }
  }

  return null;
}

function isLoopback(request) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function assertAuthorized(request, url) {
  if (isLoopback(request)) return;
  if (syncToken && url.searchParams.get("token") === syncToken) return;
  const error = new Error("Unauthorized");
  error.statusCode = 401;
  throw error;
}

async function updateUsage(remaining, source, resetCandidate = "") {
  const weeklyRemaining = normalizePercent(remaining);
  if (weeklyRemaining === null) {
    throw new Error("Weekly remaining must be a number between 0 and 100.");
  }

  let previous = {};
  try {
    previous = JSON.parse(await readFile(usagePath, "utf8"));
  } catch (_error) {
    previous = {};
  }

  const usage = {
    weeklyRemaining,
    refreshedAt: new Date().toISOString(),
    source: normalizeSource(source)
  };

  const normalizedResetAt = normalizeResetCandidate(resetCandidate, previous.resetAt);
  if (normalizedResetAt) {
    usage.resetAt = normalizedResetAt;
  } else if (previous.resetAt) {
    usage.resetAt = previous.resetAt;
  }

  if (dryRun) return { usage, pushed: false, dryRun: true };

  await writeFile(usagePath, `${JSON.stringify(usage, null, 2)}\n`);

  await run("git", ["add", "usage.json"]);
  const status = (await run("git", ["status", "--porcelain", "--", "usage.json"])).stdout.trim();
  if (!status) return { usage, pushed: false, dryRun: false };

  await run("git", ["commit", "-m", `Sync usage ${weeklyRemaining}%`]);
  await run("git", ["push"]);

  return { usage, pushed: true, dryRun: false };
}

async function readOcrText(imagePath) {
  const result = await run(tesseractCommand, [imagePath, "stdout", "--psm", "6"]);
  return result.stdout;
}

function screenshotArgs(screenshotPath, region) {
  const args = ["-x"];
  if (region) args.push("-R", `${region.x},${region.y},${region.width},${region.height}`);
  args.push(screenshotPath);
  return args;
}

async function captureScreenshot(screenshotPath, region = null) {
  const args = screenshotArgs(screenshotPath, region);
  const regionShell = region ? ` -R ${shellQuote(`${region.x},${region.y},${region.width},${region.height}`)}` : "";
  const attempts = [
    ["/usr/sbin/screencapture", args],
    ["/bin/launchctl", ["asuser", String(process.getuid()), "/usr/sbin/screencapture", ...args]],
    ["/usr/bin/osascript", ["-e", `do shell script "/usr/sbin/screencapture -x${regionShell} ${shellQuote(screenshotPath)}"`]]
  ];
  const errors = [];

  for (const [command, args] of attempts) {
    try {
      await run(command, args);
      return;
    } catch (error) {
      errors.push(`${command}: ${String(error.stderr || error.message || error).trim()}`);
    }
  }

  throw new Error(`Could not capture Mac screen. ${errors.join(" ")}`);
}

async function getCodexWindowBounds() {
  const { x, y, width, height } = codexCaptureBounds;
  const script = `
tell application "Codex" to activate
delay 0.2
tell application "System Events"
  tell process "Codex"
    set frontmost to true
    set position of window 1 to {${x}, ${y}}
    set size of window 1 to {${width}, ${height}}
    delay 0.1
    set windowPosition to position of window 1
    set windowSize to size of window 1
    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)
  end tell
end tell`;
  const result = await run("/usr/bin/osascript", ["-e", script]);
  const values = result.stdout.trim().split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Could not read Codex window bounds.");
  }

  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3]
  };
}

async function clickPoint(x, y) {
  await run(cliclickCommand, [`c:${Math.round(x)},${Math.round(y)}`]);
}

async function revealChromeUsagePage() {
  const { x, y, width, height } = chromeCaptureBounds;
  const right = x + width;
  const bottom = y + height;
  const escapedUsageUrl = chromeUsageUrl.replace(/"/g, '\\"');
  const script = `
tell application "System Events"
  if exists process "ChatGPT Atlas" then
    tell process "ChatGPT Atlas"
      repeat with atlasWindow in windows
        set position of atlasWindow to {2600, 80}
      end repeat
    end tell
  end if
end tell
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set bounds of front window to {${x}, ${y}, ${right}, ${bottom}}
  set usageUrl to "${escapedUsageUrl}"
  set foundUsageTab to false
  repeat with tabIndex from 1 to count of tabs of front window
    set tabUrl to URL of tab tabIndex of front window
    if tabUrl starts with "https://chatgpt.com/codex/cloud/settings/analytics" then
      set active tab index of front window to tabIndex
      set URL of tab tabIndex of front window to usageUrl
      set foundUsageTab to true
      exit repeat
    end if
  end repeat
  if foundUsageTab is false then
    set newTab to make new tab at end of tabs of front window with properties {URL:usageUrl}
    set active tab index of front window to count of tabs of front window
  end if
end tell`;

  await run("/usr/bin/osascript", ["-e", script]);
  await run("/usr/bin/osascript", [
    "-e",
    `tell application "System Events" to tell process "Google Chrome" to set frontmost to true`
  ]);
  await new Promise((resolve) => setTimeout(resolve, 6500));
}

async function revealCodexUsageMenu() {
  const bounds = await getCodexWindowBounds();

  await run("/usr/bin/osascript", [
    "-e",
    `tell application "System Events" to tell process "Codex" to key code 53`
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));

  await clickPoint(bounds.x + 44, bounds.y + bounds.height - 23);
  await new Promise((resolve) => setTimeout(resolve, 250));

  await clickPoint(bounds.x + 92, bounds.y + bounds.height - 88);
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function readUsageFromMacScreen(options = {}) {
  const screenshotPath = join(tmpdir(), `codex-usage-${process.pid}-${Date.now()}.png`);

  try {
    await captureScreenshot(screenshotPath, options.region || null);
    const text = await readOcrText(screenshotPath);
    const weeklyRemaining = options.chromeAnalytics
      ? findChromeAnalyticsWeeklyPercent(text)
      : findWeeklyPercent(text);
    const reset = options.skipReset ? null : findWeeklyReset(text);

    return { weeklyRemaining, reset };
  } finally {
    unlink(screenshotPath).catch(() => {});
  }
}

async function pollUsageFromMac() {
  const errors = [];

  if (revealSource) {
    try {
      await revealChromeUsagePage();
      const chromeUsage = await readUsageFromMacScreen({ chromeAnalytics: true, skipReset: true, region: chromeWeeklyRegion });
      if (chromeUsage.weeklyRemaining !== null) {
        return updateUsage(chromeUsage.weeklyRemaining, "chrome-ocr", chromeUsage.reset);
      }
      errors.push("Chrome analytics page did not expose weekly usage.");
    } catch (error) {
      errors.push(`Chrome analytics source failed: ${error.message}`);
    }
  }

  let revealError = null;
  if (revealSource) {
    try {
      await revealCodexUsageMenu();
    } catch (error) {
      revealError = error;
    }
  }

  let usage = await readUsageFromMacScreen();

  if (usage.weeklyRemaining === null && !revealSource) {
    await revealCodexUsageMenu();
    usage = await readUsageFromMacScreen();
  }

  if (usage.weeklyRemaining === null) {
    const details = errors.length ? ` ${errors.join(" ")}` : "";
    const reason = revealError ? ` Source reveal failed: ${revealError.message}` : details;
    throw new Error(`Could not find weekly usage in the Mac usage menu.${reason}`);
  }

  return updateUsage(usage.weeklyRemaining, "mac-ocr", usage.reset);
}

async function pollUsageFromImage(imagePath) {
  const text = await readOcrText(imagePath);
  const weeklyRemaining = findWeeklyPercent(text);
  const reset = findWeeklyReset(text);

  if (weeklyRemaining === null) {
    throw new Error("Could not find weekly usage in OCR text.");
  }

  return updateUsage(weeklyRemaining, "mac-ocr-test", reset);
}

function send(response, statusCode, body, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Content-Type": contentType
  });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(303, {
    "Cache-Control": "no-store",
    "Location": location
  });
  response.end("");
}

function appUrlForResult(result, returnTo) {
  const remaining = result.usage.weeklyRemaining;
  let appUrl = new URL("https://rivermanpaul.github.io/CodexUsage/");

  if (returnTo) {
    const requested = new URL(returnTo);
    const safeHosts = new Set(["rivermanpaul.github.io", "localhost", "127.0.0.1"]);
    if ((requested.protocol === "https:" || requested.protocol === "http:") && safeHosts.has(requested.hostname)) {
      appUrl = requested;
    }
  }

  appUrl.searchParams.set("remaining", String(remaining));
  if (result.usage.resetAt) appUrl.searchParams.set("reset", result.usage.resetAt);
  appUrl.searchParams.set("synced", String(Date.now()));
  return appUrl.href;
}

function html(result, source = "Synced", returnTo = "") {
  const remaining = result.usage.weeklyRemaining;
  const appUrl = appUrlForResult(result, returnTo);
  const detail = result.dryRun
    ? "Dry run complete."
    : result.pushed
      ? "Published to GitHub. Phone refresh may take a few seconds."
      : "Value was already current.";

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Usage Synced</title>
<body style="background:#080907;color:#f4f6ef;font:16px system-ui;padding:24px">
  <main style="max-width:520px;margin:auto">
    <h1>${source} ${remaining}%</h1>
    <p>${detail}</p>
    <p><a href="${appUrl}" style="color:#8ee79d">Open Codex Usage</a></p>
  </main>
</body>
</html>`;
}

function json(result) {
  return JSON.stringify({
    ok: true,
    pushed: result.pushed,
    dryRun: result.dryRun,
    usage: result.usage
  });
}

if (process.argv[2] === "--once") {
  updateUsage(process.argv[3], "cli", process.argv[4]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else if (process.argv[2] === "--ocr-file") {
  pollUsageFromImage(process.argv[3]).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else if (process.argv[2] === "--poll-once") {
  pollUsageFromMac().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      send(response, 204, "");
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/health") {
      send(response, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
      return;
    }

    if (url.pathname !== "/sync" && url.pathname !== "/poll") {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    try {
      assertAuthorized(request, url);

      if (url.pathname === "/poll") {
        const result = await pollUsageFromMac();
        const returnTo = url.searchParams.get("return") || "";
        if (returnTo) {
          redirect(response, appUrlForResult(result, returnTo));
          return;
        }

        const wantsJson = url.searchParams.get("format") === "json" || request.headers.accept?.includes("application/json");
        send(response, 200, wantsJson ? json(result) : html(result, "Polled"), wantsJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
        return;
      }

      const reset = url.searchParams.get("reset")
        ? { resetAt: url.searchParams.get("reset"), exactTime: url.searchParams.get("resetExact") !== "0" }
        : "";
      const result = await updateUsage(url.searchParams.get("remaining"), url.searchParams.get("source"), reset);
      send(response, 200, html(result));
    } catch (error) {
      send(response, error.statusCode || 400, error.message, "text/plain; charset=utf-8");
    }
  }).listen(port, host, () => {
    console.log(`Codex Usage sync helper listening on http://${host}:${port}`);
  });
}
