// Configurações, as mesmas do app web: perfil, segurança (senha, recuperação, PIN, duas etapas, inatividade,
// impressão digital, aparelhos), caixas de agente, convites, tema, idioma, espaço e apagar a conta.
import CoreImage.CIFilterBuiltins
import PhotosUI
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var l10n: L10n
    @Environment(\.dismiss) private var dismiss
    let session: Session

    @State private var security: SecurityState?
    @State private var recovery: RecoveryState?
    @State private var devices: [Device] = []
    @State private var summary: StorageSummary?
    @State private var inviteOnly = false
    @State private var name = ""
    @State private var nameSaved = false
    @State private var photo: PhotosPickerItem?
    @State private var avatarV = Date().timeIntervalSince1970
    @State private var sheet: Sheet?
    @State private var note: String?
    @State private var error: String?
    @AppStorage("shalom-theme") private var theme = AppTheme.dark.rawValue
    @ObservedObject private var push = Push.shared

    enum Sheet: Identifiable { case password, recovery, pin, totp, delete, storage, agents, invites; var id: Self { self } }

    var body: some View {
        NavigationStack {
            Form {
                if let note { Section { Label(note, systemImage: "checkmark.circle.fill").foregroundStyle(Palette.safe).font(.system(size: 14)) } }
                if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
                profile
                securitySection
                Section(t("settings.agents.title")) {
                    Button { sheet = .agents } label: { row(t("settings.agents.openLabel"), t("settings.agents.openDesc")) }
                    if inviteOnly { Button { sheet = .invites } label: { row(t("settings.inv.title"), t("settings.inv.desc")) } }
                }
                Section(header: Text(t("settings.looks")), footer: Text(t("settings.looksDesc"))) {
                    Picker(t("settings.appTheme"), selection: $theme) {
                        Text(t("settings.dark")).tag(AppTheme.dark.rawValue)
                        Text(t("settings.light")).tag(AppTheme.light.rawValue)
                    }
                    Picker(t("settings.appLanguage"), selection: Binding(get: { l10n.lang }, set: { lang in
                        l10n.set(lang)
                        Task { _ = try? await API.shared.call("/profile/lang", ["lang": lang]) }
                    })) {
                        ForEach(L10n.supported, id: \.self) { code in Text(Locale(identifier: code).localizedString(forLanguageCode: code)?.capitalized(with: Locale(identifier: code)) ?? code).tag(code) }
                    }
                }
                Section(header: Text(t("ios.push.title")), footer: Text(t("ios.push.desc"))) {
                    if push.status == .denied {
                        Text(t("ios.push.denied")).font(.system(size: 14)).foregroundStyle(Palette.text2)
                        Button(t("ios.push.openSettings")) {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    } else {
                        Toggle(t("ios.push.toggle"), isOn: Binding(get: { push.isOn(session.user) }, set: { on in Task { await push.set(on, for: session.user) } }))
                            .tint(Palette.safe)
                    }
                }
                Section(header: Text(t("settings.space")), footer: Text(t("settings.spaceDesc"))) {
                    Button { sheet = .storage } label: { StorageBarView(summary: summary) }
                }
                Section {
                    Button(role: .destructive) { sheet = .delete } label: { Text(t("settings.del.open")) }
                } header: { Text(t("settings.del.title")) } footer: { Text(t("settings.del.rowDesc")) }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.bg)
            .navigationTitle(t("settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
            .task { await load() }
            .sheet(item: $sheet) { s in
                NavigationStack {
                    switch s {
                    case .password: PasswordPanel(session: session) { done(t("settings.passwordChanged")) }
                    case .recovery: RecoveryPanel(session: session, current: recovery) { hint, sent in recovery = RecoveryState(hint: hint, verified: false); done(t(sent ? "settings.recoverySent" : "settings.recoveryNotSent", ["email": hint ?? ""])) }
                    case .pin: PinPanel(session: session, on: security?.pin ?? false) { on in security?.pin = on; done(t(on ? "settings.pinCreated" : "settings.pinRemoved")) }
                    case .totp: TotpPanel(session: session, on: security?.totp ?? false) { text in done(text) }
                    case .delete: DeletePanel(session: session)
                    case .storage: StorageView(session: session)
                    case .agents: AgentsView()
                    case .invites: InvitesView()
                    }
                }
                .environmentObject(app)
            }
        }
    }

    private func done(_ text: String) {
        sheet = nil
        note = text
        Task { await load() }
    }

    private func row(_ title: String, _ desc: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).foregroundStyle(Palette.text)
            Text(desc).font(.system(size: 13)).foregroundStyle(Palette.text3)
        }
    }

    private var profile: some View {
        Section(header: Text(t("settings.profile")), footer: Text(t("settings.profileDesc"))) {
            HStack(spacing: 14) {
                PhotosPicker(selection: $photo, matching: .images) {
                    AsyncImage(url: AccountAPI.avatarURL(session.user.address, v: avatarV)) { img in img.resizable().scaledToFill() } placeholder: {
                        Avatar(name: session.user.name, address: session.user.address, size: 56)
                    }
                    .frame(width: 56, height: 56).clipShape(Circle())
                    .overlay(alignment: .bottomTrailing) { Image(systemName: "camera.fill").font(.system(size: 10)).padding(5).background(Palette.surface, in: Circle()) }
                }
                .accessibilityLabel(t("settings.changePhoto"))
                VStack(alignment: .leading, spacing: 4) {
                    TextField(t("settings.yourName"), text: $name).font(.system(size: 17, weight: .semibold)).submitLabel(.done).onSubmit(saveName)
                    Text(session.user.address).font(.system(size: 13)).foregroundStyle(Palette.text3)
                }
                if nameSaved { Image(systemName: "checkmark").foregroundStyle(Palette.safe) }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                        do { try await AccountAPI.uploadAvatar(img); avatarV = Date().timeIntervalSince1970 } catch { self.error = error.localizedDescription }
                    }
                    photo = nil
                }
            }
        }
    }

    private var securitySection: some View {
        Section(header: Text(t("settings.security")), footer: Text(t("settings.securityDesc"))) {
            Button { sheet = .password } label: { row(t("settings.password"), t("settings.passwordDesc")) }
            Button { sheet = .recovery } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text(t("settings.recovery")).foregroundStyle(Palette.text); if recovery?.verified == true { badge(t("settings.confirmedBadge")) } }
                    if let hint = recovery?.hint {
                        Text(recovery?.verified == true ? t("settings.recoveryOk", ["email": hint]) : t("settings.recoveryPending", ["email": hint]))
                            .font(.system(size: 13)).foregroundStyle(recovery?.verified == true ? Palette.text3 : Palette.warn)
                    } else { Text(t("settings.recoveryNone")).font(.system(size: 13)).foregroundStyle(Palette.warn) }
                }
            }
            if recovery?.hint != nil && recovery?.verified == false {
                Button(t("settings.resend")) { Task { note = (try? await AccountAPI.resendRecovery()) == true ? t("settings.resent", ["email": recovery?.hint ?? ""]) : nil; if note == nil { error = t("settings.resendFail") } } }
            }
            Button { sheet = .pin } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text(t("settings.pin")).foregroundStyle(Palette.text); if security?.pin == true { badge(t("settings.pinOn")) } }
                    Text(t("settings.pinDesc")).font(.system(size: 13)).foregroundStyle(Palette.text3)
                }
            }
            Button { sheet = .totp } label: {
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text(t("settings.totp")).foregroundStyle(Palette.text); if security?.totp == true { badge(t("settings.totpOn")) } }
                    Text(security?.totp == true ? (security!.recoveryLeft == 0 ? t("settings.codesNone") : tn("settings.codesLeft", security!.recoveryLeft)) : t("settings.totpDesc"))
                        .font(.system(size: 13)).foregroundStyle(security?.totp == true && (security?.recoveryLeft ?? 0) <= 2 ? Palette.warn : Palette.text3)
                }
            }
            if let sec = security {
                Picker(t("settings.idle"), selection: Binding(get: { sec.idle }, set: { m in
                    security?.idle = m
                    app.setIdle(m)
                    Task { do { try await AccountAPI.setIdle(m) } catch { self.error = t("settings.idleFail") } }
                })) {
                    ForEach(AccountAPI.idleChoices, id: \.self) { m in Text(duration(m)).tag(m) }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(t("settings.myFp"))
                Text(Fingerprint.of(address: session.user.address, publicKey: Data(b64: session.user.publicKey) ?? Data()))
                    .font(.system(size: 15, weight: .medium, design: .monospaced)).foregroundStyle(Palette.text).environment(\.layoutDirection, .leftToRight)
                Text(t("settings.myFpDesc")).font(.system(size: 13)).foregroundStyle(Palette.text3)
            }
            DisclosureGroup(t("settings.devices")) {
                ForEach(devices) { d in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.current ? t("settings.thisDevice") : deviceName(d.user_agent)).font(.system(size: 14))
                            Text(seen(d.last_seen)).font(.system(size: 12)).foregroundStyle(Palette.text3)
                        }
                        Spacer()
                        if !d.current {
                            Button(t("settings.disconnect")) { Task { do { try await AccountAPI.revokeDevice(d.id); devices.removeAll { $0.id == d.id } } catch { self.error = t("settings.devicesFail") } } }
                                .font(.system(size: 13)).foregroundStyle(Palette.warn)
                        }
                    }
                }
            }
        }
    }

    private func badge(_ text: String) -> some View {
        Text(text).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.safe).padding(.horizontal, 7).padding(.vertical, 2).background(Palette.safe.opacity(0.14), in: Capsule())
    }

    private func load() async {
        name = session.user.name
        async let s = try? AccountAPI.security()
        async let r = try? AccountAPI.recovery()
        async let d = try? AccountAPI.devices()
        async let st = try? AccountAPI.storage()
        async let cfg = try? AccountAPI.config()
        security = await s
        recovery = await r
        devices = await d ?? []
        summary = await st?.summary
        inviteOnly = (await cfg)?["inviteOnly"] as? Bool ?? false
    }

    private func saveName() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n != session.user.name else { return }
        Task {
            do { let saved = try await AccountAPI.saveName(n); app.renamed(saved); nameSaved = true } catch { self.error = t("settings.nameFail") }
        }
    }

    private func duration(_ minutes: Int) -> String {
        let f = DateComponentsFormatter()
        f.unitsStyle = .full
        f.allowedUnits = minutes >= 1440 ? [.day] : minutes >= 60 ? [.hour] : [.minute]
        var cal = Calendar.current; cal.locale = l10n.locale; f.calendar = cal
        return f.string(from: TimeInterval(minutes * 60)) ?? "\(minutes)"
    }

    private func deviceName(_ ua: String) -> String {
        if ua.contains("iPhone") { return "iPhone" }
        if ua.contains("iPad") { return "iPad" }
        if ua.contains("Android") { return "Android" }
        if ua.contains("Mac") { return "Mac" }
        if ua.contains("Windows") { return "Windows" }
        return t("settings.unknownBrowser")
    }

    private func seen(_ ms: Double) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter(); f.locale = l10n.locale; f.timeStyle = .short
        if Calendar.current.isDateInToday(d) { return t("settings.seenToday", ["time": f.string(from: d)]) }
        if Calendar.current.isDateInYesterday(d) { return t("settings.seenYesterday", ["time": f.string(from: d)]) }
        f.dateStyle = .medium; f.timeStyle = .none
        return t("settings.seenOn", ["date": f.string(from: d)])
    }
}

// Espaço usado: barra por pasta.
struct StorageBarView: View {
    let summary: StorageSummary?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let s = summary {
                HStack {
                    Text("\(ByteCountFormatter.string(fromByteCount: Int64(s.used), countStyle: .memory)) / \(ByteCountFormatter.string(fromByteCount: Int64(s.quota), countStyle: .memory))")
                        .font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text)
                    Spacer()
                    Text("\(s.quota > 0 ? Int(Double(s.used) / Double(s.quota) * 100) : 0)%").font(.system(size: 13)).foregroundStyle(Palette.text3)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.fill2)
                        Capsule().fill(Palette.text2).frame(width: s.quota > 0 ? max(4, geo.size.width * CGFloat(s.used) / CGFloat(s.quota)) : 0)
                    }
                }
                .frame(height: 6)
            } else { ProgressView() }
        }
        .padding(.vertical, 4)
    }
}

// Painel com a senha atual e a nova (a mesma chave privada é trancada de novo).
struct PasswordPanel: View {
    @Environment(\.dismiss) private var dismiss
    let session: Session
    let done: () -> Void
    @State private var current = ""
    @State private var next = ""
    @State private var repeatPw = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section(t("settings.confirmYou")) { SecureField(t("settings.pwCurrent"), text: $current).textContentType(.password) }
            Section(header: Text(t("settings.pwChooseNew")), footer: Text(t("settings.pwRule"))) {
                SecureField(t("settings.pwNew"), text: $next).textContentType(.newPassword)
                SecureField(t("settings.pwRepeat"), text: $repeatPw).textContentType(.newPassword)
                if !repeatPw.isEmpty { Text(t(repeatPw == next ? "settings.pwMatch" : "settings.pwNoMatch")).font(.system(size: 13)).foregroundStyle(repeatPw == next ? Palette.safe : Palette.warn) }
            }
            Section { Text(t("settings.pwOthersOut")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
            if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
        }
        .navigationTitle(t("settings.password")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button { submit() } label: { if busy { ProgressView() } else { Text(t("settings.pwChange")) } }.disabled(busy || current.isEmpty || next.isEmpty)
            }
        }
    }

    private func submit() {
        guard next.count >= 8 else { error = t("settings.pwMin"); return }
        guard next == repeatPw else { error = t("settings.pwMismatch"); return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { try await AccountAPI.changePassword(session, current: current, next: next); done() } catch { self.error = (error as? APIError)?.message ?? t("settings.pwFail") }
        }
    }
}

struct RecoveryPanel: View {
    @Environment(\.dismiss) private var dismiss
    let session: Session
    let current: RecoveryState?
    let done: (String?, Bool) -> Void
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section(header: Text(t("settings.recoveryWhere")), footer: Text(t("settings.recoveryWhereDesc"))) {
                TextField(t("recovery.emailPlaceholder"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.emailAddress)
            }
            if current?.hint != nil { Section(t("settings.confirmYou")) { SecureField(t("settings.accountPassword"), text: $password).textContentType(.password) } }
            if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
        }
        .navigationTitle(t("settings.recovery")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button { submit() } label: { if busy { ProgressView() } else { Text(t("settings.saveAndSend")) } }
                    .disabled(busy || !email.contains("@") || (current?.hint != nil && password.isEmpty))
            }
        }
    }

    private func submit() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let r = try await AccountAPI.setRecovery(email.trimmingCharacters(in: .whitespaces), confirm: current?.hint != nil ? (session.user, password) : nil)
                done(r.hint, r.sent)
            } catch { self.error = (error as? APIError)?.message ?? t("settings.recoverySaveFail") }
        }
    }
}

struct PinPanel: View {
    @Environment(\.dismiss) private var dismiss
    let session: Session
    let on: Bool
    let done: (Bool) -> Void
    @State private var password = ""
    @State private var pin = ""
    @State private var repeatPin = ""
    @State private var busy = false
    @State private var error: String?

    private var weak: Bool {
        guard pin.count == 6 else { return false }
        let d = pin.compactMap { $0.wholeNumberValue }
        let seq = zip(d, d.dropFirst()).allSatisfy { $1 - $0 == 1 } || zip(d, d.dropFirst()).allSatisfy { $0 - $1 == 1 }
        return Set(d).count <= 2 || seq
    }

    var body: some View {
        Form {
            Section(t("settings.confirmYou")) { SecureField(t("settings.accountPassword"), text: $password).textContentType(.password) }
            if !on {
                Section(header: Text(t("settings.pinChoose")), footer: Text(t("settings.pinAvoid"))) {
                    SecureField(t("settings.pinNew"), text: $pin).keyboardType(.numberPad).onChange(of: pin) { _, v in pin = String(v.filter(\.isNumber).prefix(6)) }
                    SecureField(t("settings.pinRepeat"), text: $repeatPin).keyboardType(.numberPad).onChange(of: repeatPin) { _, v in repeatPin = String(v.filter(\.isNumber).prefix(6)) }
                    if weak { Text(t("settings.pinWeak")).font(.system(size: 13)).foregroundStyle(Palette.warn) }
                    else if repeatPin.count == 6 { Text(t(repeatPin == pin ? "settings.pinMatch" : "settings.pinMismatch")).font(.system(size: 13)).foregroundStyle(repeatPin == pin ? Palette.safe : Palette.warn) }
                }
            } else {
                Section { Text(t("settings.pinOffHint")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
            }
            if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
        }
        .navigationTitle(t("settings.pin")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button { submit() } label: { if busy { ProgressView() } else { Text(t(on ? "settings.removePin" : "settings.createPin")) } }
                    .disabled(busy || password.isEmpty || (!on && (pin.count != 6 || pin != repeatPin || weak)))
            }
        }
    }

    private func submit() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                if on { try await AccountAPI.removePin(session.user, password) } else { try await AccountAPI.setPin(session.user, password, pin) }
                done(!on)
            } catch { self.error = (error as? APIError)?.message ?? t(on ? "settings.pinRemoveFail" : "settings.pinCreateFail") }
        }
    }
}

// Duas etapas: ligar (QR, código, códigos de recuperação), gerar códigos novos ou desligar.
struct TotpPanel: View {
    @Environment(\.dismiss) private var dismiss
    let session: Session
    let on: Bool
    let done: (String) -> Void
    @State private var password = ""
    @State private var started: (secret: String, uri: String)?
    @State private var code = ""
    @State private var codes: [String] = []
    @State private var mode: Mode = .start
    @State private var busy = false
    @State private var error: String?
    @State private var keptCodes = false
    enum Mode { case start, newCodes, off }

    var body: some View {
        Form {
            if !codes.isEmpty {
                Section(header: Text(t(on ? "settings.newTitle" : "settings.freshTitle")), footer: Text(t("settings.codesOnce"))) {
                    ForEach(codes, id: \.self) { Text($0).font(.system(size: 16, design: .monospaced)) }
                    ShareLink(item: codes.joined(separator: "\n")) { Label(t("settings.codesList"), systemImage: "square.and.arrow.up") }
                    Toggle(t("settings.savedCheck"), isOn: $keptCodes)
                }
            } else if let s = started {
                Section(t("settings.scanTitle")) {
                    if let img = qr(s.uri) { Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(width: 200, height: 200).frame(maxWidth: .infinity) }
                    Text(s.secret).font(.system(size: 14, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity)
                    Text(t("settings.noCamera")).font(.system(size: 12.5)).foregroundStyle(Palette.text3)
                }
                Section(t("settings.typeCodeLong")) {
                    TextField(t("settings.code6"), text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode).onChange(of: code) { _, v in code = String(v.filter(\.isNumber).prefix(6)) }
                }
            } else {
                if on {
                    Picker("", selection: $mode) { Text(t("settings.makeNew")).tag(Mode.newCodes); Text(t("settings.turnOff")).tag(Mode.off) }.pickerStyle(.segmented)
                        .onAppear { if mode == .start { mode = .newCodes } }
                    Section { Text(t(mode == .off ? "settings.offDesc" : "settings.codesReplace")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
                } else {
                    Section { Text(t("settings.startDesc")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
                }
                Section(t("settings.confirmYou")) { SecureField(t("settings.accountPassword"), text: $password).textContentType(.password) }
            }
            if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
        }
        .navigationTitle(t("settings.totp")).navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(!codes.isEmpty && !keptCodes)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { if codes.isEmpty { Button(t("common.cancel")) { dismiss() } } }
            ToolbarItem(placement: .confirmationAction) {
                Button { next() } label: { if busy { ProgressView() } else { Text(action) } }.disabled(busy || !ready)
            }
        }
    }

    private var action: String {
        if !codes.isEmpty { return t("settings.finish") }
        if started != nil { return t("settings.turnOnTotp") }
        if on { return t(mode == .off ? "settings.turnOffTotp" : "settings.makeCodes") }
        return t("common.continue")
    }
    private var ready: Bool {
        if !codes.isEmpty { return keptCodes }
        if started != nil { return code.count == 6 }
        return !password.isEmpty
    }

    private func next() {
        if !codes.isEmpty { done(t(on ? "settings.codesDone" : "settings.totpDone")); return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                if started != nil { codes = try await AccountAPI.enableTotp(code); return }
                if on && mode == .off { try await AccountAPI.disableTotp(session.user, password); done(t("settings.totpOff")); return }
                if on { codes = try await AccountAPI.newRecoveryCodes(session.user, password); return }
                started = try await AccountAPI.startTotp(session.user, password)
            } catch { self.error = (error as? APIError)?.message ?? t("settings.continueFail") }
        }
    }

    private func qr(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)), let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

struct DeletePanel: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.dismiss) private var dismiss
    let session: Session
    @State private var password = ""
    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section { Text(t("settings.del.rowDesc")).font(.system(size: 14)) }
            Section(t("settings.confirmYou")) { SecureField(t("settings.accountPassword"), text: $password).textContentType(.password) }
            Section(header: Text(t("settings.del.typeTitle")), footer: Text(t("settings.del.typeDesc", ["address": session.user.address]))) {
                TextField(session.user.address, text: $typed).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress)
            }
            Section { Text(t("settings.del.note")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
            if let error { Section { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) } }
            Section {
                Button(role: .destructive) { submit() } label: { HStack { if busy { ProgressView() }; Text(t(busy ? "settings.del.busy" : "settings.del.confirm")) } }
                    .disabled(busy || password.isEmpty || typed.trimmingCharacters(in: .whitespaces).lowercased() != session.user.address)
            }
        }
        .navigationTitle(t("settings.del.title")).navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } } }
    }

    private func submit() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                try await AccountAPI.deleteAccount(session.user, password, confirm: typed)
                app.notice = t("settings.del.done")
                await app.signOut()
            } catch { self.error = (error as? APIError)?.message ?? t("settings.del.fail") }
        }
    }
}
