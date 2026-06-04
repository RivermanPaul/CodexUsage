import SwiftUI

@main
struct CodexUsageApp: App {
    @StateObject private var model = UsageViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}
