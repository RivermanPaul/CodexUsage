(function () {
  "use strict";

  var storageKey = "codex-budget-state-v1";
  var remoteUsageApiUrl = "https://api.github.com/repos/RivermanPaul/CodexUsage/contents/usage.json?ref=main";
  var remoteUsageUrl = "https://raw.githubusercontent.com/RivermanPaul/CodexUsage/main/usage.json";
  var defaultMacPollUrl = "http://127.0.0.1:8787/poll";
  var dayMs = 24 * 60 * 60 * 1000;
  var defaults = {
    remaining: 70,
    dailyAllowance: 14,
    resetAt: "2026-06-07T08:33"
  };

  var remainingInput = document.getElementById("remainingInput");
  var remainingRange = document.getElementById("remainingRange");
  var dailyInput = document.getElementById("dailyInput");
  var resetInput = document.getElementById("resetInput");
  var resetDisplay = document.getElementById("resetDisplay");
  var remainingValue = document.getElementById("remainingValue");
  var remainingBar = document.getElementById("remainingBar");
  var targetMarker = document.getElementById("targetMarker");
  var dayPill = document.getElementById("dayPill");
  var targetValue = document.getElementById("targetValue");
  var roomValue = document.getElementById("roomValue");
  var resetSummary = document.getElementById("resetSummary");
  var paceCopy = document.getElementById("paceCopy");
  var refreshButton = document.getElementById("refreshButton");
  var refreshStatus = document.getElementById("refreshStatus");
  var refreshStatusText = document.getElementById("refreshStatusText");
  var syncSheet = document.getElementById("syncSheet");
  var syncForm = document.getElementById("syncForm");
  var syncRemainingInput = document.getElementById("syncRemainingInput");
  var syncCancel = document.getElementById("syncCancel");

  var state = loadState();
  var refreshTimer = null;

  function loadState() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      return Object.assign({}, defaults, stored || {});
    } catch (_error) {
      return Object.assign({}, defaults);
    }
  }

  function saveState() {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function ensureRefreshTime() {
    if (!state.lastRefreshedAt) {
      state.lastRefreshedAt = new Date().toISOString();
      saveState();
    }
  }

  function applyUrlSync() {
    var params = new URLSearchParams(window.location.search);
    var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var remaining = params.get("remaining") || params.get("weekly");
    var reset = params.get("reset");
    var helper = hashParams.get("helper");
    var token = hashParams.get("token");
    var mode = hashParams.get("mode");
    var changed = false;
    var usageChanged = false;

    if (remaining !== null && remaining.trim() !== "") {
      state.remaining = clamp(remaining, 0, 100);
      changed = true;
      usageChanged = true;
    }

    if (reset !== null && reset.trim() !== "" && !Number.isNaN(new Date(reset).getTime())) {
      state.resetAt = reset;
      changed = true;
      usageChanged = true;
    }

    if (helper !== null && helper.trim() !== "") {
      var helperUrl = normalizeMacPollUrl(helper);
      if (helperUrl) {
        state.macPollUrl = helperUrl;
        changed = true;
      }
    }

    if (token !== null && token.trim() !== "") {
      state.macPollToken = token.trim();
      changed = true;
    }

    if (mode !== null && mode.trim() !== "") {
      state.macPollMode = mode.trim();
      changed = true;
    }

    if (changed) {
      if (usageChanged) state.lastRefreshedAt = new Date().toISOString();
      saveState();
      window.history.replaceState(null, "", window.location.pathname);
    }

    return usageChanged;
  }

  function clamp(value, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function normalizePercent(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return null;
    return clamp(number, 0, 100);
  }

  function normalizeMacPollUrl(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      if (!url.pathname || url.pathname === "/") url.pathname = "/poll";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function getMacPollUrl() {
    if (state.macPollUrl) return state.macPollUrl;
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return defaultMacPollUrl;
    if (navigator.userAgent.indexOf("Macintosh") !== -1 && navigator.maxTouchPoints < 2) return defaultMacPollUrl;
    return "";
  }

  function shouldNavigateMacPoll() {
    return Boolean(state.macPollUrl) && state.macPollMode !== "fetch";
  }

  function formatPercent(value) {
    var rounded = Math.round(value * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "%";
  }

  function formatReset(value) {
    var reset = new Date(value);
    if (Number.isNaN(reset.getTime())) return "Set reset";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(reset);
  }

  function formatResetControl(value) {
    var reset = new Date(value);
    if (Number.isNaN(reset.getTime())) return "Set reset";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(reset);
  }

  function formatRefreshTime(value) {
    var refreshed = new Date(value);
    if (Number.isNaN(refreshed.getTime())) return "Last refreshed just now";
    return "Last refreshed " + new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(refreshed);
  }

  function toLocalInputValue(date) {
    var offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function localMidnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getCycle(resetAt) {
    var reset = new Date(resetAt);
    var now = new Date();

    if (Number.isNaN(reset.getTime())) {
      return { day: 1, reset: null };
    }

    while (reset.getTime() <= now.getTime()) {
      reset = new Date(reset.getTime() + 7 * dayMs);
    }

    var cycleStart = new Date(reset.getTime() - 7 * dayMs);
    var elapsedCalendarDays = Math.round((localMidnight(now).getTime() - localMidnight(cycleStart).getTime()) / dayMs);
    var day = clamp(elapsedCalendarDays + 1, 1, 7);

    return { day: day, reset: reset };
  }

  function render() {
    state.remaining = clamp(state.remaining, 0, 100);
    state.dailyAllowance = clamp(state.dailyAllowance, 1, 25);

    var cycle = getCycle(state.resetAt);
    var parsedReset = new Date(state.resetAt);
    if (cycle.reset && parsedReset.getTime() !== cycle.reset.getTime()) {
      state.resetAt = toLocalInputValue(cycle.reset);
      saveState();
    }

    var eodUsed = clamp(cycle.day * state.dailyAllowance, 0, 100);
    var targetRemaining = clamp(100 - eodUsed, 0, 100);
    var roomToday = state.remaining - targetRemaining;

    remainingInput.value = String(state.remaining);
    remainingRange.value = String(state.remaining);
    dailyInput.value = String(state.dailyAllowance);
    resetInput.value = state.resetAt;
    resetDisplay.textContent = formatResetControl(state.resetAt);
    refreshStatusText.textContent = formatRefreshTime(state.lastRefreshedAt);

    remainingValue.textContent = formatPercent(state.remaining);
    remainingBar.style.width = state.remaining + "%";
    targetMarker.style.left = targetRemaining + "%";
    dayPill.textContent = "Day " + cycle.day + " of 7";
    targetValue.textContent = formatPercent(targetRemaining);
    roomValue.textContent = roomToday >= 0 ? formatPercent(roomToday) : "-" + formatPercent(Math.abs(roomToday));
    resetSummary.textContent = formatReset(state.resetAt);

    remainingBar.style.background = roomToday < 0
      ? "linear-gradient(90deg, var(--red), #ff9a78)"
      : roomToday < 5
        ? "linear-gradient(90deg, var(--amber), #f7d475)"
        : "linear-gradient(90deg, var(--green), var(--green-2))";

    paceCopy.classList.toggle("danger", roomToday < 0);
    paceCopy.classList.toggle("warning", roomToday >= 0 && roomToday < 5);

    if (roomToday < 0) {
      paceCopy.textContent = "Over pace by " + formatPercent(Math.abs(roomToday)) + ".";
    } else if (roomToday < 0.05) {
      paceCopy.textContent = "Right on pace.";
    } else {
      paceCopy.textContent = "Ahead by " + formatPercent(roomToday) + ".";
    }
  }

  function setRemaining(value) {
    state.remaining = clamp(value, 0, 100);
    state.lastRefreshedAt = new Date().toISOString();
    saveState();
    render();
  }

  function setRefreshing(isRefreshing, message) {
    refreshButton.classList.toggle("is-refreshing", isRefreshing);
    refreshStatus.classList.toggle("is-refreshing", isRefreshing);
    refreshButton.disabled = isRefreshing;
    refreshStatusText.textContent = isRefreshing ? (message || "Refreshing...") : formatRefreshTime(state.lastRefreshedAt);
  }

  function refreshStats(allowMacPoll) {
    window.clearTimeout(refreshTimer);

    if (allowMacPoll && shouldNavigateMacPoll()) {
      navigateToMacPoll();
      return;
    }

    setRefreshing(true, allowMacPoll && getMacPollUrl() ? "Polling Mac..." : "Fetching latest...");

    Promise.all([
      (allowMacPoll ? pollMacHelper() : Promise.resolve(null)).then(function (macUsage) {
        setRefreshing(true, "Fetching latest...");
        return fetchRemoteUsage().then(function (remoteUsage) {
          return newestUsage(macUsage, remoteUsage);
        }).catch(function () {
          if (macUsage) return macUsage;
          throw new Error("Remote usage fetch failed.");
        });
      }),
      new Promise(function (resolve) {
        refreshTimer = window.setTimeout(resolve, 550);
      })
    ]).then(function (results) {
      var usage = results[0];
      var percent = usage ? normalizePercent(usage.weeklyRemaining) : null;

      if (percent === null) {
        throw new Error("No weekly remaining value found.");
      }

      state.remaining = percent;
      if (usage.resetAt && !Number.isNaN(new Date(usage.resetAt).getTime())) {
        state.resetAt = usage.resetAt;
      }
      state.lastRefreshedAt = usage.refreshedAt || new Date().toISOString();
      saveState();
      render();
      setRefreshing(false);
    }).catch(function () {
      setRefreshing(false);
      openSyncSheet();
    });
  }

  function newestUsage(first, second) {
    if (!first) return second;
    if (!second) return first;

    var firstTime = new Date(first.refreshedAt || 0).getTime();
    var secondTime = new Date(second.refreshedAt || 0).getTime();
    return firstTime >= secondTime ? first : second;
  }

  function pollMacHelper() {
    var pollUrl = getMacPollUrl();
    if (!pollUrl) return Promise.resolve(null);

    var url = new URL(pollUrl);
    url.searchParams.set("format", "json");
    url.searchParams.set("cache", Date.now());
    if (state.macPollToken) url.searchParams.set("token", state.macPollToken);

    var controller = window.AbortController ? new AbortController() : null;
    var timeout = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 7000);

    return fetch(url.href, {
      cache: "no-store",
      credentials: "omit",
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error("Mac helper poll failed.");
      return response.json();
    }).then(function (data) {
      return data && data.usage ? data.usage : data;
    }).catch(function () {
      return null;
    }).finally(function () {
      window.clearTimeout(timeout);
    });
  }

  function navigateToMacPoll() {
    var pollUrl = getMacPollUrl();
    if (!pollUrl) {
      refreshStats(false);
      return;
    }

    setRefreshing(true, "Polling Mac...");

    var url = new URL(pollUrl);
    var returnUrl = new URL(window.location.href);
    returnUrl.hash = "";
    url.searchParams.set("return", returnUrl.href);
    url.searchParams.set("cache", Date.now());
    if (state.macPollToken) url.searchParams.set("token", state.macPollToken);
    window.location.href = url.href;
  }

  function fetchRemoteUsage() {
    var localUsageUrl = new URL("usage.json", window.location.href).href;
    var localDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    var sources = localDev
      ? [function () { return fetchJson(localUsageUrl); }, fetchGitHubUsage, function () { return fetchJson(remoteUsageUrl); }]
      : [fetchGitHubUsage, function () { return fetchJson(localUsageUrl); }, function () { return fetchJson(remoteUsageUrl); }];

    function trySource(index) {
      if (index >= sources.length) throw new Error("Remote usage fetch failed.");
      return sources[index]().catch(function () {
        return trySource(index + 1);
      });
    }

    return trySource(0);
  }

  function fetchJson(url) {
    var separator = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + separator + "cache=" + Date.now(), {
      cache: "no-store",
      credentials: "omit"
    }).then(function (response) {
      if (!response.ok) throw new Error("Remote usage fetch failed.");
      return response.json();
    });
  }

  function fetchGitHubUsage() {
    return fetch(remoteUsageApiUrl + "&cache=" + Date.now(), {
        cache: "no-store",
        credentials: "omit"
    }).then(function (response) {
      if (!response.ok) throw new Error("Remote usage fetch failed.");
      return response.json();
    }).then(function (data) {
      if (data.weeklyRemaining !== undefined) return data;
      if (!data.content) throw new Error("Remote usage fetch failed.");
      return JSON.parse(window.atob(String(data.content).replace(/\s/g, "")));
    });
  }

  function openSyncSheet() {
    syncRemainingInput.value = String(state.remaining);
    syncSheet.hidden = false;
    window.setTimeout(function () {
      syncRemainingInput.focus();
      syncRemainingInput.select();
    }, 0);
  }

  function closeSyncSheet() {
    syncSheet.hidden = true;
    refreshButton.focus();
  }

  remainingInput.addEventListener("input", function (event) {
    setRemaining(event.target.value);
  });

  remainingRange.addEventListener("input", function (event) {
    setRemaining(event.target.value);
  });

  dailyInput.addEventListener("input", function (event) {
    state.dailyAllowance = clamp(event.target.value, 1, 25);
    state.lastRefreshedAt = new Date().toISOString();
    saveState();
    render();
  });

  resetInput.addEventListener("input", function (event) {
    state.resetAt = event.target.value;
    state.lastRefreshedAt = new Date().toISOString();
    saveState();
    render();
  });

  document.querySelectorAll("[data-adjust]").forEach(function (button) {
    button.addEventListener("click", function () {
      setRemaining(state.remaining + Number(button.dataset.adjust));
    });
  });

  refreshButton.addEventListener("click", function () {
    refreshStats(true);
  });

  syncCancel.addEventListener("click", closeSyncSheet);

  syncSheet.addEventListener("click", function (event) {
    if (event.target === syncSheet) closeSyncSheet();
  });

  syncForm.addEventListener("submit", function (event) {
    event.preventDefault();
    state.remaining = clamp(syncRemainingInput.value, 0, 100);
    state.lastRefreshedAt = new Date().toISOString();
    saveState();
    closeSyncSheet();
    render();
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !syncSheet.hidden) closeSyncSheet();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  var syncedFromUrl = applyUrlSync();
  ensureRefreshTime();
  render();
  if (!syncedFromUrl) refreshStats(false);
}());
