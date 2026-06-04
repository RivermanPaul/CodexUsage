import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var model: UsageViewModel

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.06, green: 0.07, blue: 0.06), .black], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    statusLine
                    meterCard
                    controls
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }

            if !model.showBrowser {
                WebViewContainer(webView: model.scraper.webView)
                    .frame(width: 1, height: 1)
                    .opacity(0.01)
                    .accessibilityHidden(true)
            }
        }
        .sheet(isPresented: $model.showBrowser) {
            LoginBrowserView()
                .environmentObject(model)
        }
        .onAppear {
            if model.snapshot.lastCheckedAt == nil {
                model.refresh()
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Codex")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.secondary)
                Text("Budget")
                    .font(.system(size: 62, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.75)
            }

            Spacer()

            Button(action: model.refresh) {
                ZStack {
                    Image(systemName: "arrow.clockwise")
                        .opacity(model.isRefreshing ? 0 : 1)
                    if model.isRefreshing {
                        ProgressView()
                            .tint(.white)
                    }
                }
                .frame(width: 48, height: 48)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 8))
            .disabled(model.isRefreshing)
            .accessibilityLabel("Refresh usage")
        }
    }

    private var statusLine: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(model.errorText == nil ? Color.green : Color.red)
                .frame(width: 9, height: 9)
                .shadow(color: (model.errorText == nil ? Color.green : Color.red).opacity(0.25), radius: 4)

            Text(model.errorText ?? model.statusText)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(model.errorText == nil ? .secondary : Color(red: 1, green: 0.69, blue: 0.66))
                .lineLimit(2)
        }
    }

    private var meterCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                Text("Weekly remaining")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.secondary)

                Spacer()

                Text("Day \(model.cycleDay) of 7")
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(Color(red: 0.84, green: 0.92, blue: 1))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.blue.opacity(0.18), in: Capsule())
                    .overlay(Capsule().stroke(Color.blue.opacity(0.5), lineWidth: 1))
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(percent(model.snapshot.weeklyRemaining))
                    .font(.system(size: 82, weight: .heavy, design: .rounded))
                    .minimumScaleFactor(0.55)
                Text("remaining")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.92))
                    .frame(height: 15)
                Capsule()
                    .fill(roomColor)
                    .frame(width: barWidth(model.snapshot.weeklyRemaining), height: 15)
                Rectangle()
                    .fill(Color(red: 0.48, green: 0.72, blue: 1))
                    .frame(width: 3, height: 25)
                    .offset(x: barWidth(model.targetRemaining))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(alignment: .top) {
                stat("EOD target", percent(model.targetRemaining))
                Spacer()
                stat("Room today", signedPercent(model.roomToday))
                Spacer()
                stat("Resets", UsageViewModel.resetFormatter.string(from: model.resetAt))
            }

            Text(paceText)
                .font(.title3.weight(.heavy))
                .foregroundStyle(model.roomToday < 0 ? Color(red: 1, green: 0.43, blue: 0.37) : .white)
        }
        .padding(22)
        .background(Color(red: 0.12, green: 0.13, blue: 0.12), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.14), lineWidth: 1))
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Daily")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.secondary)
                    Stepper(value: Binding(
                        get: { model.snapshot.dailyAllowance },
                        set: { model.setDailyAllowance($0) }
                    ), in: 1...25, step: 1) {
                        Text(percent(model.snapshot.dailyAllowance))
                            .font(.title.weight(.heavy))
                    }
                }
            }

            Button {
                model.loadUsagePageForLogin()
            } label: {
                Label("Open ChatGPT Session", systemImage: "globe")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.33, green: 0.78, blue: 0.40))
        }
        .padding(18)
        .background(Color(red: 0.14, green: 0.16, blue: 0.14), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.14), lineWidth: 1))
    }

    private var roomColor: Color {
        if model.roomToday < 0 { return Color(red: 1, green: 0.43, blue: 0.37) }
        if model.roomToday < 5 { return Color(red: 0.95, green: 0.73, blue: 0.29) }
        return Color(red: 0.33, green: 0.78, blue: 0.40)
    }

    private var paceText: String {
        if model.roomToday < 0 { return "Over pace by \(percent(abs(model.roomToday)))." }
        if model.roomToday < 0.05 { return "Right on pace." }
        return "Ahead by \(percent(model.roomToday))."
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2.weight(.heavy))
                .lineLimit(2)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func percent(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(rounded))%" : String(format: "%.1f%%", rounded)
    }

    private func signedPercent(_ value: Double) -> String {
        value < 0 ? "-\(percent(abs(value)))" : percent(value)
    }

    private func barWidth(_ percent: Double) -> CGFloat {
        let clamped = min(100, max(0, percent))
        return UIScreen.main.bounds.width * 0.82 * CGFloat(clamped / 100)
    }
}

struct LoginBrowserView: View {
    @EnvironmentObject private var model: UsageViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebViewContainer(webView: model.scraper.webView)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("ChatGPT")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Close") {
                            dismiss()
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(model.isRefreshing ? "Reading..." : "Use Page") {
                            model.scrapeAfterLogin()
                        }
                        .disabled(model.isRefreshing)
                    }
                }
        }
        .onAppear {
            model.scraper.loadUsagePage()
        }
    }
}
