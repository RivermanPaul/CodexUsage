(function () {
  "use strict";

  var storageKey = "codex-budget-state-v1";
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

  function clamp(value, min, max) {
    var number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
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

  function setRefreshing(isRefreshing) {
    refreshButton.classList.toggle("is-refreshing", isRefreshing);
    refreshStatus.classList.toggle("is-refreshing", isRefreshing);
    refreshButton.disabled = isRefreshing;
    refreshStatusText.textContent = isRefreshing ? "Refreshing..." : formatRefreshTime(state.lastRefreshedAt);
  }

  function refreshStats() {
    window.clearTimeout(refreshTimer);
    setRefreshing(true);
    refreshTimer = window.setTimeout(function () {
      state.lastRefreshedAt = new Date().toISOString();
      saveState();
      render();
      setRefreshing(false);
    }, 550);
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

  refreshButton.addEventListener("click", refreshStats);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  ensureRefreshTime();
  render();
}());
