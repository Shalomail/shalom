// Entrar, no mesmo fluxo do app web: endereço, senha (a prova sai do Argon2id aqui no iPhone), e a segunda
// etapa quando a conta tem PIN e/ou o código do autenticador.
import SwiftUI

struct SignInView: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var l10n: L10n

    enum Step { case address, password, pin, totp }
    @State private var step: Step = .address
    @State private var local = ""
    @State private var password = ""
    @State private var remember = true
    @State private var pin = ""
    @State private var code = ""
    @State private var useRecovery = false
    @State private var second: SecondStep?
    @State private var busy = false
    @State private var error: String?
    @State private var missing = false
    @State private var signingUp = false
    @State private var forgotSent = false
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 72)
                Logo(size: 64).padding(.bottom, 36)
                if let notice = app.notice, step == .address { Note(text: notice, tone: .warn).padding(.bottom, 18) }
                Text(title).font(.system(size: 28, weight: .semibold)).tracking(-0.6).foregroundStyle(Palette.text).multilineTextAlignment(.center)
                    .padding(.bottom, 24)
                field
                below.padding(.top, 14)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focused = true }
        .safeAreaInset(edge: .top) {
            HStack {
                if app.addingFrom != nil { QuietButton(title: t("common.cancel")) { app.cancelAdding() } }
                Spacer()
                if step == .address { QuietButton(title: t("auth.createAccount")) { signingUp = true } }
            }
            .padding(.horizontal, 20).padding(.top, 6)
        }
        .fullScreenCover(isPresented: $signingUp) { NavigationStack { SignUpView() } }
    }

    private var title: String {
        switch step {
        case .address: return t("auth.signInTitle")
        case .password: return t("auth.passwordTitle")
        case .pin: return t("auth.pinTitle")
        case .totp: return t(useRecovery ? "auth.recoveryTitle" : "auth.codeTitle")
        }
    }

    @ViewBuilder private var field: some View {
        switch step {
        case .address:
            ArrowField(icon: "at", ready: !local.trimmingCharacters(in: .whitespaces).isEmpty, busy: busy, action: checkAddress) {
                HStack(spacing: 0) {
                    // "name@shalomail.com" numa linha só: o sufixo anda colado no que se digita, como no web.
                    TextField("", text: $local, prompt: Text(t("auth.addressPlaceholder")).foregroundStyle(Palette.text3))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).textContentType(.username)
                        .focused($focused).submitLabel(.continue).onSubmit(checkAddress)
                        .fixedSize()
                        .accessibilityLabel(t("auth.addressLabel"))
                    if !local.contains("@") { Text("@\(AppModel.domain)").foregroundStyle(Palette.text3).lineLimit(1) }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
                .onTapGesture { focused = true }
                .environment(\.layoutDirection, .leftToRight)
            }
        case .password:
            VStack(spacing: 16) {
                ArrowField(icon: "lock", ready: !password.isEmpty, busy: busy, action: submit) {
                    SecureField(t("pw.label"), text: $password).textContentType(.password).focused($focused).submitLabel(.go).onSubmit(submit)
                }
                Toggle(t("auth.remember"), isOn: $remember).font(.system(size: 14)).foregroundStyle(Palette.text2).tint(Palette.safe).frame(maxWidth: 304)
            }
        case .pin:
            ArrowField(icon: "shield", ready: pin.count == 6, busy: busy, action: finishSecond) {
                SecureField(t("auth.pinPlaceholder"), text: $pin).keyboardType(.numberPad).focused($focused)
                    .onChange(of: pin) { _, v in pin = String(v.filter(\.isNumber).prefix(6)) }
            }
        case .totp:
            ArrowField(icon: "shield", ready: useRecovery ? code.filter { $0.isLetter || $0.isNumber }.count == 8 : code.count == 6, busy: busy, action: finishSecond) {
                TextField(useRecovery ? "xxxx-xxxx" : t("auth.codePlaceholder"), text: $code)
                    .keyboardType(useRecovery ? .asciiCapable : .numberPad).textContentType(.oneTimeCode).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focused)
                    .onChange(of: code) { _, v in code = useRecovery ? String(v.prefix(9)) : String(v.filter(\.isNumber).prefix(6)) }
            }
        }
    }

    @ViewBuilder private var below: some View {
        VStack(spacing: 18) {
            if let error { Note(text: error, tone: .warn) }
            else if missing { Note(text: t("auth.noAccount", ["address": AppModel.fullAddress(local)]), tone: .warn) }
            else {
                switch step {
                case .address: Note(text: t("auth.signInNote"), tone: .secure)
                case .password: EmptyView()
                case .pin: Note(text: t("auth.pinNote"))
                case .totp: Note(text: t(useRecovery ? "auth.recoveryNote" : "auth.codeNote"))
                }
            }
            if step == .totp {
                QuietButton(title: t(useRecovery ? "auth.useApp" : "auth.noPhone")) { useRecovery.toggle(); code = ""; error = nil }
            }
            if step == .password {
                if forgotSent { Note(text: t("auth.forgotSent")) } else { QuietButton(title: t("auth.forgot")) { forgot() } }
                QuietButton(title: t("auth.changeAddress")) { step = .address; password = ""; error = nil; forgotSent = false }
            }
            if step == .pin || step == .totp {
                QuietButton(title: t("common.back")) { second = nil; pin = ""; code = ""; error = nil; step = .password }
            }
        }
    }

    private func checkAddress() {
        let value = local.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, !busy else { return }
        busy = true; error = nil; missing = false; app.notice = nil
        Task {
            defer { busy = false }
            do {
                let r = try await API.shared.call("/auth/exists", ["address": AppModel.fullAddress(value)])
                if r["exists"] as? Bool == true { step = .password; focused = true } else { missing = true }
            } catch { self.error = (error as? APIError)?.message ?? t("auth.checkFail") }
        }
    }

    // Esqueci a senha: o link vai para o e-mail de recuperação e abre a página de senha nova.
    private func forgot() {
        Task {
            do { try await AccountAPI.forgot(AppModel.fullAddress(local)); forgotSent = true } catch { self.error = error.localizedDescription }
        }
    }

    private func submit() {
        guard !password.isEmpty, !busy else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                if let s = try await app.signIn(address: local, password: password, remember: remember) {
                    second = s
                    step = s.pin ? .pin : .totp
                    focused = true
                }
                password = ""
            } catch { self.error = error.localizedDescription }
        }
    }

    private func finishSecond() {
        guard let s = second, !busy else { return }
        // PIN primeiro; com as duas etapas ligadas, o servidor espera os dois juntos.
        if step == .pin && s.totp { step = .totp; focused = true; return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await app.signInSecond(s, pin: s.pin ? pin : nil, code: s.totp && !useRecovery ? code : nil, recovery: s.totp && useRecovery ? code : nil)
            } catch {
                self.error = error.localizedDescription
                if (error as? APIError)?.code == "ticket" { second = nil; pin = ""; code = ""; step = .password }
            }
        }
    }
}
