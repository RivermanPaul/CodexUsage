import Foundation

struct ScrapedUsage {
    var weeklyRemaining: Double
    var resetAt: Date?
    var pageTitle: String
    var pageURL: String
}

enum UsageScrapeError: LocalizedError {
    case needsLogin
    case noUsageFound
    case invalidPage

    var errorDescription: String? {
        switch self {
        case .needsLogin:
            return "Not signed in to ChatGPT. Log in, then refresh."
        case .noUsageFound:
            return "Could not find weekly usage on the page."
        case .invalidPage:
            return "Could not read the usage page."
        }
    }
}

struct UsageSnapshot: Codable {
    var weeklyRemaining: Double
    var dailyAllowance: Double
    var resetAt: Date
    var lastCheckedAt: Date?
    var sourceDataAt: Date?

    static var fallback: UsageSnapshot {
        UsageSnapshot(
            weeklyRemaining: 70,
            dailyAllowance: 14,
            resetAt: Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date(),
            lastCheckedAt: nil,
            sourceDataAt: nil
        )
    }
}
