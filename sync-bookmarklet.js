(function () {
  "use strict";

  var appUrl = "https://rivermanpaul.github.io/CodexUsage/";
  var helperUrl = "http://127.0.0.1:8787/sync";

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n+/g, "\n");
  }

  function normalizePercent(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return null;
    var clamped = Math.min(100, Math.max(0, number));
    var rounded = Math.round(clamped * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function toLocalInputValue(date) {
    function pad(value) {
      return String(value).padStart(2, "0");
    }

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + "T" + [pad(date.getHours()), pad(date.getMinutes())].join(":");
  }

  function monthIndex(value) {
    var months = {
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
    var parts = String(time).split(":");
    var hour = Number(parts[0]);
    var minute = Number(parts[1]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    var marker = String(meridiem || "").toLowerCase();
    if (marker === "pm" && hour < 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;

    return { hour: hour, minute: minute };
  }

  function resetFromMatch(match) {
    var now = new Date();
    var month = monthIndex(match[1]);
    var day = Number(match[2]);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return "";

    var year = match[3] ? Number(match[3]) : now.getFullYear();
    var parsedTime = parseMeridiemTime(match[4], match[5]);
    var exactTime = Boolean(parsedTime);
    var hour = parsedTime ? parsedTime.hour : now.getHours();
    var minute = parsedTime ? parsedTime.minute : now.getMinutes();
    var reset = new Date(year, month, day, hour, minute);

    if (!match[3] && reset.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
      reset = new Date(year + 1, month, day, hour, minute);
    }

    return { resetAt: toLocalInputValue(reset), exactTime: exactTime };
  }

  function findWeeklyPercent(text) {
    var normalized = normalizeText(text);
    var patterns = [
      /Usage remaining[\s\S]{0,240}?Weekly\s+(\d{1,3}(?:\.\d+)?)\s*%/i,
      /Weekly\s+(\d{1,3}(?:\.\d+)?)\s*%/i,
      /Weekly usage limit[\s\S]{0,140}?(\d{1,3}(?:\.\d+)?)\s*%\s*remaining/i,
      /Weekly[\s\S]{0,140}?(\d{1,3}(?:\.\d+)?)\s*%\s*remaining/i
    ];

    for (var index = 0; index < patterns.length; index += 1) {
      var match = normalized.match(patterns[index]);
      if (match) {
        var percent = normalizePercent(match[1]);
        if (percent !== null) return percent;
      }
    }

    return null;
  }

  function findWeeklyResetAt(text) {
    var normalized = normalizeText(text);
    var patterns = [
      /Usage remaining[\s\S]{0,520}?Weekly\s+\d{1,3}(?:\.\d+)?\s*%\s+([A-Z][a-z]{2})\s*(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}:\d{2})\s*([AP]M))?/i,
      /Weekly usage limit[\s\S]{0,320}?Resets\s+([A-Z][a-z]{2})\s*(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2}:\d{2})\s*([AP]M))?/i
    ];

    for (var index = 0; index < patterns.length; index += 1) {
      var match = normalized.match(patterns[index]);
      if (match) {
        var reset = resetFromMatch(match);
        if (reset) return reset;
      }
    }

    return null;
  }

  var pageText = document.body ? document.body.innerText || document.body.textContent : "";
  var percent = findWeeklyPercent(pageText);
  var reset = findWeeklyResetAt(pageText);

  if (percent === null) {
    var manual = window.prompt("Weekly remaining percent?");
    percent = normalizePercent(manual);
  }

  if (percent === null) {
    window.alert("I could not find the weekly remaining percent. Open the ChatGPT usage menu or analytics page, then try again.");
    return;
  }

  var target = helperUrl + "?remaining=" + encodeURIComponent(percent) + "&source=bookmarklet&synced=" + Date.now();
  if (reset) {
    target += "&reset=" + encodeURIComponent(reset.resetAt) + "&resetExact=" + (reset.exactTime ? "1" : "0");
  }
  var opened = window.open(target, "_blank");

  if (!opened) {
    var fallback = appUrl + "?remaining=" + encodeURIComponent(percent) + "&source=bookmarklet&synced=" + Date.now();
    if (reset) fallback += "&reset=" + encodeURIComponent(reset.resetAt);
    window.location.href = fallback;
  }
}());
