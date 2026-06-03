(function () {
  "use strict";

  var appUrl = "https://rivermanpaul.github.io/CodexUsage/";

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

  var pageText = document.body ? document.body.innerText || document.body.textContent : "";
  var percent = findWeeklyPercent(pageText);

  if (percent === null) {
    var manual = window.prompt("Weekly remaining percent?");
    percent = normalizePercent(manual);
  }

  if (percent === null) {
    window.alert("I could not find the weekly remaining percent. Open the ChatGPT usage menu or analytics page, then try again.");
    return;
  }

  var target = appUrl + "?remaining=" + encodeURIComponent(percent) + "&source=bookmarklet&synced=" + Date.now();
  var opened = window.open(target, "_blank");

  if (!opened) {
    window.location.href = target;
  }
}());
