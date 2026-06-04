import Foundation
import WebKit

@MainActor
final class UsageScraper: NSObject, ObservableObject {
    static let usageURL = URL(string: "https://chatgpt.com/codex/cloud/settings/analytics#usage")!

    let webView: WKWebView

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isInspectable = true
        super.init()
        webView.navigationDelegate = self
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
    }

    func loadUsagePage() {
        var request = URLRequest(url: Self.usageURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        webView.load(request)
    }

    func refreshAndScrape() async throws -> ScrapedUsage {
        loadUsagePage()
        try await Task.sleep(nanoseconds: 2_000_000_000)
        return try await scrapeWithRetries()
    }

    func scrapeVisiblePage() async throws -> ScrapedUsage {
        try await scrapeWithRetries()
    }

    private func scrapeWithRetries() async throws -> ScrapedUsage {
        var sawLogin = false

        for _ in 0..<15 {
            let page = try await inspectPage()
            if let percent = page.percent {
                return ScrapedUsage(
                    weeklyRemaining: percent,
                    resetAt: parseReset(page.resetText),
                    pageTitle: page.title,
                    pageURL: page.href
                )
            }

            sawLogin = sawLogin || page.needsLogin
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }

        throw sawLogin ? UsageScrapeError.needsLogin : UsageScrapeError.noUsageFound
    }

    private struct PageInspection {
        var href: String
        var title: String
        var percent: Double?
        var resetText: String?
        var needsLogin: Bool
    }

    private func inspectPage() async throws -> PageInspection {
        let script = """
        (() => {
          const body = document.body;
          const text = body ? body.innerText : "";
          const weeklyIndex = text.search(/Weekly usage limit/i);
          const weeklySlice = weeklyIndex >= 0 ? text.slice(weeklyIndex, weeklyIndex + 700) : text;
          const percentMatch = weeklySlice.match(/(\\d{1,3}(?:\\.\\d+)?)\\s*%\\s*remaining/i);
          const resetMatch = weeklySlice.match(/Resets\\s+([^\\n]+)/i);
          const loginLike = /(log in|sign up|continue with|enter your password|welcome|verify)/i.test(text);
          return {
            href: location.href,
            title: document.title || "",
            percent: percentMatch ? Number(percentMatch[1]) : null,
            resetText: resetMatch ? resetMatch[1].trim() : null,
            needsLogin: weeklyIndex < 0 && loginLike
          };
        })();
        """

        guard let value = try await evaluate(script) as? [String: Any] else {
            throw UsageScrapeError.invalidPage
        }

        let percent = (value["percent"] as? NSNumber)?.doubleValue

        return PageInspection(
            href: value["href"] as? String ?? "",
            title: value["title"] as? String ?? "",
            percent: percent,
            resetText: value["resetText"] as? String,
            needsLogin: value["needsLogin"] as? Bool ?? false
        )
    }

    private func evaluate(_ script: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { value, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: value)
                }
            }
        }
    }

    private func parseReset(_ text: String?) -> Date? {
        guard let text, !text.isEmpty else { return nil }

        let cleaned = text
            .replacingOccurrences(of: " at ", with: " ")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current

        let formats = [
            "MMM d yyyy h:mm a",
            "MMM d h:mm a",
            "MMM d yyyy",
            "MMM d"
        ]

        for format in formats {
            formatter.dateFormat = format
            if let date = formatter.date(from: cleaned) {
                if format.contains("yyyy") {
                    return date
                }

                let currentYear = Calendar.current.component(.year, from: Date())
                var components = Calendar.current.dateComponents([.month, .day, .hour, .minute], from: date)
                components.year = currentYear
                guard let thisYear = Calendar.current.date(from: components) else { return date }

                if thisYear < Date().addingTimeInterval(-12 * 60 * 60) {
                    components.year = currentYear + 1
                    return Calendar.current.date(from: components) ?? thisYear
                }

                return thisYear
            }
        }

        return nil
    }
}

extension UsageScraper: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Scraping is driven by explicit refresh actions; this keeps navigation side effects predictable.
    }
}
