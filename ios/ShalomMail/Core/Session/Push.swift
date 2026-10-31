// Aviso de mensagem nova. O iPhone pede licença uma vez, a Apple dá o token do aparelho e ele vai para a
// conta aberta (cada conta deste iPhone tem a própria sessão, e o aviso vale enquanto ela existir). O aviso
// não traz nada da mensagem: só "Mensagem nova" e o número de não lidas da Entrada no ícone.
import SwiftUI
import UIKit
import UserNotifications
import os

private let log = Logger(subsystem: "com.shalomail.app", category: "push")

@MainActor
final class Push: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = Push()

    @Published private(set) var status: UNAuthorizationStatus = .notDetermined
    // A Apple manda o token por callback: fica aqui a vaga da conta que estava abrindo quando ele foi pedido.
    private var waiting: Int?

    #if DEBUG
    private let env = "sandbox"
    #else
    private let env = "production"
    #endif
    private static let tokenKey = "shalom-push-token"
    private static let offKey = "shalom-push-off"

    private var token: String? {
        get { UserDefaults.standard.string(forKey: Self.tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.tokenKey) }
    }

    func start() { UNUserNotificationCenter.current().delegate = self }

    func isOn(_ user: User) -> Bool { !(UserDefaults.standard.stringArray(forKey: Self.offKey) ?? []).contains(user.id) }

    func refresh() async { status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }

    // A conta abriu: na primeira vez o iPhone pergunta; com licença, pede o token à Apple (ele pode mudar,
    // então pede sempre) e manda para esta conta.
    func accountOpened(_ user: User) async {
        guard isOn(user) else { return }
        let center = UNUserNotificationCenter.current()
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
        }
        await refresh()
        guard status == .authorized || status == .provisional else { return }
        waiting = API.shared.slot
        UIApplication.shared.registerForRemoteNotifications()
    }

    func received(_ data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        token = hex
        // Trocou de conta antes da resposta: a outra recebe o token quando abrir.
        guard let slot = waiting, slot == API.shared.slot else { return }
        waiting = nil
        Task {
            do { try await API.shared.call("/push/register", ["token": hex, "env": env]) }
            catch { log.error("o servidor não guardou o aparelho: \(error.localizedDescription, privacy: .public)") }
        }
    }

    // Saindo da conta neste iPhone (ou desligando o aviso dela): o servidor esquece o aparelho.
    func remove() async {
        guard let token else { return }
        _ = try? await API.shared.call("/push/unregister", ["token": token])
    }

    func set(_ on: Bool, for user: User) async {
        var off = Set(UserDefaults.standard.stringArray(forKey: Self.offKey) ?? [])
        if on { off.remove(user.id) } else { off.insert(user.id) }
        UserDefaults.standard.set(Array(off), forKey: Self.offKey)
        objectWillChange.send()
        if on { await accountOpened(user) } else { await remove() }
    }

    // O número no ícone acompanha as não lidas da Entrada da conta aberta.
    func badge(_ unread: Int) {
        guard status == .authorized || status == .provisional else { return }
        UNUserNotificationCenter.current().setBadgeCount(unread)
    }

    // Com o app aberto a lista já se atualiza sozinha: nada de faixa por cima.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [] }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MainActor.assumeIsolated { Push.shared.start() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { Push.shared.received(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        log.error("a Apple não deu o token: \(error.localizedDescription, privacy: .public)")
    }
}
