import SwiftUI

@main
struct ShalomMailApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app = AppModel()
    @StateObject private var l10n = L10n.shared
    @AppStorage("shalom-theme") private var theme = AppTheme.dark.rawValue
    @Environment(\.scenePhase) private var scene

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(l10n)
                .environment(\.layoutDirection, l10n.isRTL ? .rightToLeft : .leftToRight)
                .environment(\.locale, l10n.locale)
                .preferredColorScheme((AppTheme(rawValue: theme) ?? .dark).scheme)
                .tint(Palette.accent)
                // No seletor de apps a miniatura mostra só o logo, nunca um e-mail aberto.
                .overlay { if app.covered { ZStack { Palette.bg.ignoresSafeArea(); Logo(size: 56) } } }
                .onChange(of: scene) { _, phase in
                    switch phase {
                    case .background: app.wentBackground()
                    case .inactive: app.becameInactive()
                    case .active: app.cameBack(); Task { await Push.shared.refresh() }
                    @unknown default: break
                    }
                }
        }
    }
}
