#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const usagePath = join(rootDir, "usage.json");
const port = Number(process.env.CODEX_USAGE_SYNC_PORT || 8787);
const dryRun = process.env.CODEX_USAGE_DRY_RUN === "1";

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

function html(result) {
  const remaining = result.usage.weeklyRemaining;
  const appUrl = `https://rivermanpaul.github.io/CodexUsage/?remaining=${encodeURIComponent(remaining)}&synced=${Date.now()}`;
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
    <h1>Synced ${remaining}%</h1>
    <p>${detail}</p>
    <p><a href="${appUrl}" style="color:#8ee79d">Open Codex Usage</a></p>
  </main>
</body>
</html>`;
}

if (process.argv[2] === "--once") {
  updateUsage(process.argv[3], "cli").then((result) => {
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

    if (url.pathname !== "/sync") {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    try {
      const result = await updateUsage(url.searchParams.get("remaining"), url.searchParams.get("source"));
      send(response, 200, html(result));
    } catch (error) {
      send(response, 400, error.message, "text/plain; charset=utf-8");
    }
  }).listen(port, "127.0.0.1", () => {
    console.log(`Codex Usage sync helper listening on http://127.0.0.1:${port}`);
  });
}
