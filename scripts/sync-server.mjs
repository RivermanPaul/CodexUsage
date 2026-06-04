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
const syncTokenPath = process.env.CODEX_USAGE_SYNC_TOKEN_FILE || join(homedir(), "Library", "Application Support", "CodexUsage", "sync-token");
const syncToken = loadSyncToken();
const dryRun = process.env.CODEX_USAGE_DRY_RUN === "1";

function loadSyncToken() {
  if (process.env.CODEX_USAGE_SYNC_TOKEN) return process.env.CODEX_USAGE_SYNC_TOKEN.trim();

  try {
    return readFileSync(syncTokenPath, "utf8").trim();
  } catch (_error) {
    return "";
  }
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

function normalizePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10;
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
    /Usage remaining[\s\S]{0,420}?Weekly\s+(\d{1,3}(?:\.\d+)?)\s*%/i,
    /Weekly usage limit[\s\S]{0,220}?(\d{1,3}(?:\.\d+)?)\s*%\s*remaining/i
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

async function updateUsage(remaining, source) {
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

  if (previous.resetAt) usage.resetAt = previous.resetAt;

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

async function pollUsageFromMac() {
  const screenshotPath = join(tmpdir(), `codex-usage-${process.pid}-${Date.now()}.png`);

  try {
    await run("screencapture", ["-x", screenshotPath]);
    const text = await readOcrText(screenshotPath);
    const weeklyRemaining = findWeeklyPercent(text);

    if (weeklyRemaining === null) {
      throw new Error("Could not find weekly usage in the visible Mac screen. Open the ChatGPT usage menu or Codex analytics page, then try again.");
    }

    return updateUsage(weeklyRemaining, "mac-ocr");
  } finally {
    unlink(screenshotPath).catch(() => {});
  }
}

async function pollUsageFromImage(imagePath) {
  const text = await readOcrText(imagePath);
  const weeklyRemaining = findWeeklyPercent(text);

  if (weeklyRemaining === null) {
    throw new Error("Could not find weekly usage in OCR text.");
  }

  return updateUsage(weeklyRemaining, "mac-ocr-test");
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
  updateUsage(process.argv[3], "cli").then((result) => {
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

      const result = await updateUsage(url.searchParams.get("remaining"), url.searchParams.get("source"));
      send(response, 200, html(result));
    } catch (error) {
      send(response, error.statusCode || 400, error.message, "text/plain; charset=utf-8");
    }
  }).listen(port, host, () => {
    console.log(`Codex Usage sync helper listening on http://${host}:${port}`);
  });
}
