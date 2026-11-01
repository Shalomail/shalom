// Confirmar que é você: aparece quando uma ação perigosa volta do servidor com "reauth" (apagar de vez, chaves
// de API, conectar o terminal, apagar caixa de agente). Pede a senha e o segundo fator ligado, confirma (vale 10
// minutos nesta sessão) e o pedido original segue sozinho (API.send). Abre por cima de qualquer tela, até das
// folhas, porque quem pede pode estar numa delas.
import SwiftUI
import UIKit

@MainActor
final class Reauth {
    static let shared = Reauth()
    // A conta aberta (o AppModel diz qual). Sem conta, não há o que confirmar.
    var user: (() -> User?)?
    private var waiting: [CheckedContinuation<Bool, Never>] = []
    private weak var shown: UIViewController?

    // Vários pedidos ao mesmo tempo esperam a mesma confirmação.
    func ask() async -> Bool {
        guard let user = user?() else { return false }
        return await withCheckedContinuation { cont in
            waiting.append(cont)
            guard shown == nil else { return }
            guard let top = Self.top() else { finish(false); return }
            let host = UIHostingController(rootView: ReauthView(user: user) { [weak self] ok in self?.finish(ok) })
            host.isModalInPresentation = true
            shown = host
            top.present(host, animated: true)
        }
    }

    private func finish(_ ok: Bool) {
        shown?.dismiss(animated: true)
        shown = nil
        let list = waiting
        waiting = []
        list.forEach { $0.resume(returning: ok) }
    }

    private static func top() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = (scenes.first { $0.activationState == .foregroundActive } ?? scenes.first)?.windows.first { $0.isKeyWindow }
        var vc = window?.rootViewController
        while let next = vc?.presentedViewController, !next.isBeingDismissed { vc = next }
        return vc
    }
}

struct ReauthView: View {
    let user: User
    let done: (Bool) -> Void
    @State private var need = FactorNeed(pin: false, totp: false)
    @State private var password = ""
    @State private var pin = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text(t("reauth.text"))) {
                    SecureField(t("settings.accountPassword"), text: $password).textContentType(.password)
                    FactorFields(need: need, pin: $pin, code: $code)
                }
                if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
            }
            .navigationTitle(t("reauth.title")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { done(false) }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { submit() } label: { if busy { ProgressView() } else { Text(t("reauth.go")) } }
                        .disabled(busy || password.isEmpty || !need.ready(pin, code))
                }
            }
            .task { if let s = try? await AccountAPI.security() { need = FactorNeed(pin: s.pin, totp: s.totp) } }
        }
        .preferredColorScheme(AppTheme.current.scheme)
    }

    private func submit() {
        busy = true; error = nil
        Task {
            do { try await AccountAPI.confirm(user, password, factors: need.answers(pin, code)); done(true) }
            catch { self.error = (error as? APIError)?.message ?? t("common.genericError"); busy = false }
        }
    }
}
