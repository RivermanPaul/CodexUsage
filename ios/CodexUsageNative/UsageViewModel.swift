import Foundation
import SwiftUI

@MainActor
final class UsageViewModel: ObservableObject {
    @Published var snapshot: UsageSnapshot
    @Published var isRefreshing = false
    @Published var statusText = "Not checked yet"
    @Published var errorText: String?
    @Published var showBrowser = false

    let scraper = UsageScraper()

    private let storageKey = "CodexUsageNative.snapshot.v1"
    private var lastForegroundRefreshAt: Date?
    private var waitingForLogin = false

    init() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode(UsageSnapshot.self, from: data) {
            snapshot = decoded
        } else {
            snapshot = .fallback
        }
        updateStatus()
    }

    var cycleDay: Int {
        cycle().day
    }

    var targetRemaining: Double {
        min(100, max(0, 100 - Double(cycleDay) * snapshot.dailyAllowance))
    }

    var roomToday: Double {
        snapshot.weeklyRemaining - targetRemaining
    }

    var resetAt: Date {
        cycle().reset
    }

    func appBecameActive() {
        guard !isRefreshing else { return }

        if waitingForLogin && showBrowser && !scraper.isShowingUsagePage {
            return
        }

        let now = Date()
        if let lastForegroundRefreshAt,
           now.timeIntervalSince(lastForegroundRefreshAt) < 1 {
            return
        }

        lastForegroundRefreshAt = now
        openSessionAndRefresh()
    }

    func refresh() {
        guard !isRefreshing else { return }
        openSessionAndRefresh()
    }

    private func openSessionAndRefresh() {
        isRefreshing = true
        errorText = nil
        waitingForLogin = false
        showBrowser = true
        statusText = scraper.isShowingUsagePage ? "Refreshing usage page..." : "Opening ChatGPT..."

        Task {
            do {
                let usage = scraper.isShowingUsagePage
                    ? try await scraper.refreshCurrentUsagePageAndScrape()
                    : try await scraper.refreshAndScrape()
                apply(usage)
                showBrowser = false
            } catch UsageScrapeError.needsLogin {
                isRefreshing = false
                waitingForLogin = true
                errorText = UsageScrapeError.needsLogin.localizedDescription
                statusText = "Login required"
                showBrowser = true
            } catch {
                isRefreshing = false
                errorText = error.localizedDescription
                statusText = "Refresh failed"
                showBrowser = true
            }
        }
    }

    func loadUsagePageForLogin() {
        waitingForLogin = false
        scraper.loadUsagePage()
        showBrowser = true
    }

    func scrapeAfterLogin() {
        guard !isRefreshing else { return }
        isRefreshing = true
        errorText = nil
        statusText = "Reading page..."

        Task {
            do {
                let usage = try await scraper.scrapeVisiblePage()
                apply(usage)
                waitingForLogin = false
                showBrowser = false
            } catch UsageScrapeError.needsLogin {
                isRefreshing = false
                waitingForLogin = true
                errorText = UsageScrapeError.needsLogin.localizedDescription
                statusText = "Login required"
            } catch {
                isRefreshing = false
                errorText = error.localizedDescription
                statusText = "Still cannot read usage"
            }
        }
    }

    func setDailyAllowance(_ value: Double) {
        snapshot.dailyAllowance = min(25, max(1, value))
        save()
    }

    private func apply(_ usage: ScrapedUsage) {
        let now = Date()
        snapshot.weeklyRemaining = min(100, max(0, usage.weeklyRemaining))
        if let resetAt = usage.resetAt {
            snapshot.resetAt = resetAt
        }
        snapshot.lastCheckedAt = now
        snapshot.sourceDataAt = now
        isRefreshing = false
        errorText = nil
        save()
        updateStatus()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(snapshot) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func cycle() -> (day: Int, reset: Date) {
        var reset = snapshot.resetAt
        let calendar = Calendar.current
        let now = Date()

        while reset <= now {
            reset = calendar.date(byAdding: .day, value: 7, to: reset) ?? reset.addingTimeInterval(7 * 24 * 60 * 60)
        }

        let cycleStart = calendar.date(byAdding: .day, value: -7, to: reset) ?? reset.addingTimeInterval(-7 * 24 * 60 * 60)
        let startDay = calendar.startOfDay(for: cycleStart)
        let currentDay = calendar.startOfDay(for: now)
        let elapsed = calendar.dateComponents([.day], from: startDay, to: currentDay).day ?? 0
        return (min(7, max(1, elapsed + 1)), reset)
    }

    private func updateStatus() {
        guard let checked = snapshot.lastCheckedAt else {
            statusText = "Not checked yet"
            return
        }

        let checkedText = Self.statusFormatter.string(from: checked)
        let dataText = snapshot.sourceDataAt.map { Self.statusFormatter.string(from: $0) }
        statusText = dataText.map { "Checked \(checkedText) · Data \($0)" } ?? "Checked \(checkedText)"
    }

    static let statusFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .medium
        return formatter
    }()

    static let resetFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
