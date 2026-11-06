// Links que chegam por e-mail ou pelo terminal, abertos no app: senha nova (/nova-senha), confirmar o e-mail de
// recuperação (/confirmar) e conectar o terminal (/conectar, o `shalom login`).
import SwiftUI

enum IncomingLink: Identifiable {
    case reset(String), confirm(String), connect(String)
    var id: String {
        switch self { case .reset(let t): return "r\(t)"; case .confirm(let t): return "c\(t)"; case .connect(let c): return "k\(c)" }
    }

    init?(_ url: URL) {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let q = { (name: String) in comps.queryItems?.first { $0.name == name }?.value }
        // https://shalomail.com/nova-senha?t=... ou shalommail://nova-senha?t=...
        let path = url.scheme == "shalommail" ? "/\(url.host ?? "")" : url.path
        switch path {
        case "/nova-senha": guard let t = q("t") else { return nil }; self = .reset(t)
        case "/confirmar": guard let t = q("t") else { return nil }; self = .confirm(t)
        case "/conectar": guard let c = q("codigo") else { return nil }; self = .connect(c)
        default: return nil
        }
    }
}

// Senha nova: a conta volta com um par de chaves novo; os e-mails guardados até aqui não voltam (estavam
// trancados com a chave antiga). Com PIN ou duas etapas, o link sozinho não basta.
struct ResetPasswordView: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let token: String
    @State private var address: String?
    @State private var name = ""
    @State private var needPin = false
    @State private var needTotp = false
    @State private var gone: String?
    @State private var password = ""
    @State private var strength: PasswordStrength.Result?
    @State private var repeatPw = ""
    @State private var pin = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let gone { Section { Note(text: gone, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
                else if address == nil { Section { HStack { ProgressView(); Text(t("recovery.checkingLink")).foregroundStyle(Palette.text3) } } }
                else {
                    Section { Text(address ?? "").font(.system(size: 15, weight: .medium)); Text(t("recovery.warning")).font(.system(size: 13)).foregroundStyle(Palette.warn) }
                    Section(t("recovery.newPassword")) {
                        SecureField(t("recovery.newPassword"), text: $password).textContentType(.newPassword)
                        SecureField(t("pw.same"), text: $repeatPw).textContentType(.newPassword)
                        if let strength { Text(t(strength.hint)).font(.system(size: 13)).foregroundStyle(strength.ok ? Palette.text3 : Palette.warn) }
                    }
                    .disabled(busy)
                    .task(id: password) { if password.isEmpty { strength = nil } else if let r = await PasswordStrength.live(password, inputs: [address ?? "", name]) { strength = r } }
                    if needPin { Section(t("auth.pinLabel")) { SecureField(t("recovery.yourPin"), text: $pin).keyboardType(.numberPad) } }
                    if needTotp { Section(t("auth.codeLabel")) { TextField(t("recovery.codeOrRecovery"), text: $code).textContentType(.oneTimeCode).textInputAutocapitalization(.never) } }
                    if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
                    Section {
                        PrimaryButton(title: t("recovery.create"), busy: busy) { submit() }
                            .disabled(!ready).opacity(ready || busy ? 1 : 0.45)
                            .frame(maxWidth: .infinity)
                    }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle(t("recovery.create")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } } }
            .task { await info() }
        }
    }

    private var ready: Bool {
        !busy && address != nil && !password.isEmpty && password == repeatPw && (!needPin || pin.count == 6) && (!needTotp || code.count >= 6)
    }

    private func info() async {
        do {
            let r = try await API.shared.call("/auth/reset/info", ["token": token])
            address = r["address"] as? String
            name = r["name"] as? String ?? ""
            let need = r["need"] as? [String: Bool]
            needPin = need?["pin"] ?? false; needTotp = need?["totp"] ?? false
        } catch { gone = (error as? APIError)?.message ?? t("recovery.linkGone") }
    }

    private func submit() {
        guard !busy else { return }
        busy = true; error = nil
        // Confere a senha de agora, não o resultado calculado enquanto digitava (pode ser de uma senha anterior).
        let pw = password
        Task {
            defer { busy = false }
            let r = await PasswordStrength.shared.check(pw, inputs: [address ?? "", name])
            guard pw == password else { return }
            strength = r
            guard r.ok else { error = t(r.hint); return }
            guard pw == repeatPw else { error = t("settings.pwNoMatch"); return }
            do {
                try await app.resetPassword(token: token, address: address ?? "", password: pw, pin: needPin ? pin : nil,
                                            code: needTotp && code.filter(\.isNumber).count == 6 && code.count == 6 ? code : nil,
                                            recovery: needTotp && !(code.count == 6 && code.allSatisfy(\.isNumber)) ? code : nil)
                dismiss()
            } catch { self.error = (error as? APIError)?.message ?? t("recovery.resetFail") }
        }
    }
}

// Conectar o terminal (shalom login): confere o código e aprova, pela sessão do app.
struct ConnectCliView: View {
    @Environment(\.dismiss) private var dismiss
    let code: String
    @State private var device = ""
    @State private var account = ""
    @State private var state: S = .loading
    enum S { case loading, ask, busy, done, denied, gone }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: state == .done ? "checkmark.circle.fill" : "terminal").font(.system(size: 34)).foregroundStyle(state == .done ? Palette.safe : Palette.text)
                Text(t(state == .done ? "cli.doneTitle" : state == .denied ? "cli.deniedTitle" : "cli.title")).font(.system(size: 22, weight: .semibold))
                switch state {
                case .loading: ProgressView()
                case .ask, .busy:
                    Text(t("cli.lead")).font(.system(size: 14)).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
                    Text(code).font(.system(size: 28, weight: .semibold, design: .monospaced)).padding(.horizontal, 20).padding(.vertical, 10).background(Palette.fill1, in: RoundedRectangle(cornerRadius: 12))
                    Text(t("cli.codeLabel")).font(.system(size: 12.5)).foregroundStyle(Palette.text3)
                    VStack(alignment: .leading, spacing: 6) {
                        LabeledContent(t("cli.account"), value: account)
                        if !device.isEmpty { LabeledContent(t("cli.device"), value: device) }
                        LabeledContent(t("cli.access"), value: t("cli.accessText"))
                    }.font(.system(size: 13))
                    Note(text: t("cli.warn"), tone: .warn)
                    VStack(spacing: 14) {
                        PrimaryButton(title: t("cli.approve"), busy: state == .busy) { decide(true) }
                        QuietButton(title: t("cli.deny")) { decide(false) }
                    }
                    .padding(.top, 6)
                case .done: Text(t("cli.doneText")).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
                case .denied: Text(t("cli.deniedText")).foregroundStyle(Palette.text2)
                case .gone: Text(t("cli.gone")).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
                }
                Spacer()
            }
            .padding(24)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
            .task {
                do {
                    let r = try await API.shared.call("/cli/request?codigo=\(code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code)")
                    device = r["device"] as? String ?? ""; account = r["account"] as? String ?? ""; state = .ask
                } catch { state = .gone }
            }
        }
    }

    private func decide(_ yes: Bool) {
        state = .busy
        Task {
            do { try await API.shared.call(yes ? "/cli/approve" : "/cli/deny", ["code": code]); state = yes ? .done : .denied } catch { state = .gone }
        }
    }
}
