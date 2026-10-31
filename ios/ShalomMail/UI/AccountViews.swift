// Telas da conta: espaço (maiores mensagens, apagar de vez), caixas de agente e chaves de API (sem a
// assinatura dos planos, que fica fora do app pela regra 3.1.1 da Apple), convites, conferir identidade de
// um contato, criar conta (com a verificação contra robôs do Turnstile) e o e-mail de recuperação.
import SwiftUI
import WebKit

struct StorageView: View {
    @Environment(\.dismiss) private var dismiss
    let session: Session
    @State private var summary: StorageSummary?
    @State private var rows: [(row: StoredRow, subject: String, who: String)] = []
    @State private var error: String?

    var body: some View {
        List {
            Section { StorageBarView(summary: summary) }
            if let s = summary {
                Section {
                    ForEach(Folder.allCases.filter { $0 != .starred }) { f in
                        if let v = s.folders[f.rawValue], v.count > 0 {
                            HStack { Label(f.title, systemImage: f.icon); Spacer(); Text(ByteCountFormatter.string(fromByteCount: Int64(v.bytes), countStyle: .file)).foregroundStyle(Palette.text3) }
                        }
                    }
                }
            }
            Section(t("storage.biggest")) {
                ForEach(rows, id: \.row.id) { r in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.subject.isEmpty ? t("common.noSubject") : r.subject).font(.system(size: 14, weight: .medium)).lineLimit(1)
                            Text("\(r.who) · \(Folder(rawValue: r.row.folder)?.title ?? r.row.folder)").font(.system(size: 12)).foregroundStyle(Palette.text3).lineLimit(1)
                        }
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: Int64(r.row.size), countStyle: .file)).font(.system(size: 13)).foregroundStyle(Palette.text2)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            Task {
                                do { try await Mailbox.shared.deleteForever([r.row.id]); rows.removeAll { $0.row.id == r.row.id }; await load() } catch { self.error = error.localizedDescription }
                            }
                        } label: { Label(t("mailbox.deleteForever"), systemImage: "trash.slash") }
                    }
                }
            }
            if let error { Note(text: error, tone: .warn) }
        }
        .navigationTitle(t("settings.space")).navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
        .task { await load() }
    }

    private func load() async {
        guard let r = try? await AccountAPI.storage() else { error = t("storage.loadFail"); return }
        summary = r.summary
        var out: [(StoredRow, String, String)] = []
        for row in r.rows.prefix(60) {
            var subject = "", who = ""
            if let blob = Data(b64: row.head) {
                if Sender.isSealedSender(blob), let cert = try? await ServerKeys.shared.get().cert, let o = try? Sender.open(session.secretKey, blob, .head, serverPublic: cert, receivedAt: row.received_at),
                   let h = try? JSONDecoder().decode(MessageHead.self, from: o.payload) { subject = h.subject; who = o.address }
                else if let h = try? Seal.openJSON(session.secretKey, blob, as: MessageHead.self) { subject = h.subject; who = row.folder == "sent" ? (h.to.first?.address ?? "") : (h.from?.name.isEmpty == false ? h.from!.name : h.from?.address ?? "") }
            }
            out.append((row, subject, who))
        }
        rows = out
    }
}

struct AgentsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var boxes: [AgentBox] = []
    @State private var keys: [ApiKey] = []
    @State private var fresh: String?
    @State private var error: String?

    var body: some View {
        List {
            Section(header: Text(t("settings.agents.list")), footer: Text(t("settings.agents.desc"))) {
                if boxes.isEmpty { Text(t("settings.agents.step3")).foregroundStyle(Palette.text3) }
                ForEach(boxes) { b in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.address).font(.system(size: 14, weight: .medium))
                        Text(b.paused ? t("settings.agents.pausedDesc") : b.name).font(.system(size: 12)).foregroundStyle(b.paused ? Palette.warn : Palette.text3)
                    }
                    .swipeActions {
                        Button(role: .destructive) { Task { do { try await AccountAPI.deleteAgent(b.id); boxes.removeAll { $0.id == b.id } } catch { self.error = t("settings.agents.deleteFail") } } } label: { Label(t("settings.agents.delete"), systemImage: "trash") }
                    }
                }
            }
            Section(header: Text(t("settings.api.title")), footer: Text(t("settings.api.desc"))) {
                if let fresh {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("settings.api.ready")).font(.system(size: 14, weight: .semibold))
                        Text(fresh).font(.system(size: 13, design: .monospaced)).textSelection(.enabled)
                        Text(t("settings.api.readyNote")).font(.system(size: 12)).foregroundStyle(Palette.text3)
                        Button { UIPasteboard.general.string = fresh } label: { Label(t("settings.api.copied"), systemImage: "doc.on.doc") }
                    }
                }
                ForEach(keys) { k in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(k.name == "CLI" ? t("settings.api.endsWith", ["hint": k.hint]) : k.name).font(.system(size: 14))
                            Text(k.lastUsed == nil ? t("settings.api.neverUsed") : t("settings.api.usedOn", ["date": fullTime(Date(timeIntervalSince1970: k.lastUsed! / 1000))])).font(.system(size: 12)).foregroundStyle(Palette.text3)
                        }
                        Spacer()
                        Button(t("settings.api.revoke")) { Task { try? await AccountAPI.revokeKey(k.id); keys.removeAll { $0.id == k.id }; if keys.isEmpty { fresh = nil } } }
                            .font(.system(size: 13)).foregroundStyle(Palette.warn)
                    }
                }
                Button(t("settings.api.new")) { Task { do { fresh = try await AccountAPI.createKey(); keys = (try? await AccountAPI.apiKeys()) ?? keys } catch { self.error = t("settings.api.fail") } } }
            }
            if let error { Note(text: error, tone: .warn) }
        }
        .navigationTitle(t("settings.agents.title")).navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
        .task {
            boxes = (try? await AccountAPI.agents()) ?? []
            keys = (try? await AccountAPI.apiKeys()) ?? []
        }
    }
}

struct InvitesView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var invites: [Invite] = []
    @State private var fresh: String?
    @State private var error: String?

    var body: some View {
        List {
            Section(footer: Text(t("settings.inv.desc"))) {
                if let fresh {
                    let link = "\(API.shared.origin)/criar-conta?convite=\(fresh)"
                    VStack(alignment: .leading, spacing: 6) {
                        Text(t("settings.inv.ready")).font(.system(size: 14, weight: .semibold))
                        Text(t("settings.inv.readyNote")).font(.system(size: 12)).foregroundStyle(Palette.text3)
                        ShareLink(item: URL(string: link)!, message: Text(t("settings.inv.shareText"))) { Label(t("settings.inv.share"), systemImage: "square.and.arrow.up") }
                    }
                }
                Button(t("settings.inv.create")) { Task { do { fresh = try await AccountAPI.createInvite(); invites = (try? await AccountAPI.invites()) ?? invites } catch { self.error = t("settings.inv.fail") } } }
            }
            Section {
                ForEach(invites) { i in
                    HStack {
                        Text(i.usedAt == nil ? t("settings.inv.open") : t("settings.inv.used")).foregroundStyle(i.usedAt == nil ? Palette.text : Palette.text3)
                        Spacer()
                        Text(t("settings.inv.createdOn", ["date": fullTime(Date(timeIntervalSince1970: i.createdAt / 1000))])).font(.system(size: 12)).foregroundStyle(Palette.text3)
                    }
                    .swipeActions { if i.usedAt == nil { Button(role: .destructive) { Task { try? await AccountAPI.revokeInvite(i.id); invites.removeAll { $0.id == i.id } } } label: { Text(t("settings.inv.revoke")) } } }
                }
            }
            if let error { Note(text: error, tone: .warn) }
        }
        .navigationTitle(t("settings.inv.title")).navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.close")) { dismiss() } } }
        .task { invites = (try? await AccountAPI.invites()) ?? [] }
    }
}

// Conferir identidade de um contato Shalom: a impressão digital da chave dele, para comparar por fora
// (ligação, pessoalmente). Bateu: a chave fixada passa a valer como conferida por você.
struct IdentitySheet: View {
    @Environment(\.dismiss) private var dismiss
    let name: String
    let address: String
    let publicKey: String
    let userId: String
    @State private var confirmed = false

    var body: some View {
        VStack(spacing: 18) {
            Text(t("reader.idTitle", ["name": name])).font(.system(size: 20, weight: .semibold)).multilineTextAlignment(.center)
            Text(address).font(.system(size: 14)).foregroundStyle(Palette.text3)
            Text(Fingerprint.of(address: address, publicKey: Data(b64: publicKey) ?? Data()))
                .font(.system(size: 22, weight: .medium, design: .monospaced)).multilineTextAlignment(.center).environment(\.layoutDirection, .leftToRight)
                .padding(18).frame(maxWidth: .infinity).background(Palette.fill1, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if confirmed {
                Label(t("reader.idDone"), systemImage: "checkmark.seal.fill").foregroundStyle(Palette.safe).font(.system(size: 15, weight: .medium))
            } else {
                PrimaryButton(title: t("reader.idConfirm")) { Task { confirmed = await Pins.shared.confirm(userId, address, publicKey) } }
            }
        }
        .padding(24)
        .presentationDetents([.medium])
        .task { confirmed = await Pins.shared.state(userId, address).map { $0.confirmed == true && $0.pub == publicKey } ?? false }
    }
}

// A verificação contra robôs do cadastro, numa página só nossa: o widget do Turnstile e o token de volta.
struct TurnstileView: UIViewRepresentable {
    let siteKey: String
    let done: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(context.coordinator, name: "turnstile")
        cfg.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .clear
        let html = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <style>html,body{margin:0;height:100%;background:transparent;display:flex;align-items:center;justify-content:center}</style></head>
        <body><div class="cf-turnstile" data-sitekey="\(siteKey)" data-theme="auto" data-callback="ok"></div>
        <script>function ok(t){window.webkit.messageHandlers.turnstile.postMessage(t)}</script></body></html>
        """
        // A página abre "em" shalomail.com, o domínio cadastrado no widget.
        web.loadHTMLString(html, baseURL: URL(string: "https://shalomail.com/"))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let done: (String) -> Void
        init(_ done: @escaping (String) -> Void) { self.done = done }
        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            if let token = message.body as? String { done(token) }
        }
    }
}

// Criar conta, nos passos do web: nome, endereço (com a conferência de disponível), senha e a confirmação.
struct SignUpView: View {
    @EnvironmentObject var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var step = 0
    @State private var name = ""
    @State private var local = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var available: Bool?
    @State private var reason: String?
    @State private var token: String?
    @State private var siteKey = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 56)
                Logo(size: 56).padding(.bottom, 32)
                Text(t(["auth.nameTitle", "auth.addressTitle", "auth.passwordNewTitle", "auth.repeatTitle"][step]))
                    .font(.system(size: 26, weight: .semibold)).tracking(-0.5).foregroundStyle(Palette.text).multilineTextAlignment(.center).padding(.bottom, 22)
                field
                VStack(spacing: 14) {
                    if let error { Note(text: error, tone: .warn) } else { Note(text: hint, tone: step == 1 && available == false ? .warn : .plain) }
                    if step == 3 {
                        if !siteKey.isEmpty && token == nil { TurnstileView(siteKey: siteKey) { token = $0 }.frame(width: 300, height: 70) }
                        Text(t("auth.legal")).font(.system(size: 12)).foregroundStyle(Palette.text3).multilineTextAlignment(.center).frame(maxWidth: 300)
                    }
                    if step > 0 { QuietButton(title: t("common.back")) { step -= 1; error = nil } }
                }
                .padding(.top, 14)
            }
            .frame(maxWidth: .infinity).padding(.horizontal, 24)
        }
        .background(Palette.bg)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("auth.haveAccount")) { dismiss() } } }
        .task { siteKey = (try? await AccountAPI.config())?["turnstileSiteKey"] as? String ?? "" }
        .onAppear { focused = true }
    }

    private var hint: String {
        switch step {
        case 0: return t("auth.nameHint")
        case 1: return available == false ? t(reason == "reserved" ? "auth.addrReserved" : reason == "invalid" ? "auth.addrInvalid" : "auth.addrTaken") : available == true ? t("auth.addrOk") : t("auth.addrIdle")
        case 2: return t("settings.pwRule")
        default: return confirm.isEmpty ? t("auth.keyBorn") : confirm == password ? t("settings.pwMatch") : t("settings.pwNoMatch")
        }
    }

    @ViewBuilder private var field: some View {
        switch step {
        case 0:
            ArrowField(icon: "person", ready: !name.trimmingCharacters(in: .whitespaces).isEmpty, busy: false, action: next) {
                TextField(t("auth.namePlaceholder"), text: $name).textContentType(.name).focused($focused).submitLabel(.next).onSubmit(next).accessibilityIdentifier("signup-name")
            }
        case 1:
            ArrowField(icon: "at", ready: available == true, busy: busy, action: next) {
                HStack(spacing: 0) {
                    TextField("", text: $local, prompt: Text(t("auth.addressPlaceholder")).foregroundStyle(Palette.text3))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress).focused($focused).fixedSize()
                        .onChange(of: local) { _, _ in available = nil; check() }
                        .submitLabel(.next).onSubmit { if available == true { next() } }
                        .accessibilityIdentifier("signup-address")
                    Text("@\(AppModel.domain)").foregroundStyle(Palette.text3).lineLimit(1)
                    Spacer(minLength: 0)
                }.environment(\.layoutDirection, .leftToRight)
            }
        case 2:
            ArrowField(icon: "lock", ready: password.count >= 8, busy: false, action: next) {
                SecureField(t("pw.label"), text: $password).textContentType(.newPassword).focused($focused).submitLabel(.next).onSubmit(next).accessibilityIdentifier("signup-password")
            }
        default:
            ArrowField(icon: "lock", ready: confirm == password && (token != nil || siteKey.isEmpty), busy: busy, action: create) {
                SecureField(t("pw.same"), text: $confirm).textContentType(.newPassword).focused($focused).submitLabel(.go).onSubmit(create).accessibilityIdentifier("signup-confirm")
            }
        }
    }

    private func check() {
        let value = local.trimmingCharacters(in: .whitespaces).lowercased()
        guard value.count >= 3 else { return }
        Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard value == local.trimmingCharacters(in: .whitespaces).lowercased() else { return }
            let r = try? await API.shared.call("/auth/available", ["address": value])
            available = r?["available"] as? Bool
            reason = r?["reason"] as? String
        }
    }

    private func next() {
        error = nil
        if step == 2 && password.count < 8 { error = t("settings.pwMin"); return }
        if step < 3 { step += 1; focused = true }
    }

    private func create() {
        guard confirm == password else { error = t("settings.pwNoMatch"); return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { try await app.signUp(local: local.trimmingCharacters(in: .whitespaces).lowercased(), name: name.trimmingCharacters(in: .whitespaces), password: password, turnstile: token ?? "", invite: nil) }
            catch { self.error = (error as? APIError)?.message ?? t("auth.signUpFail"); token = nil }
        }
    }
}

// Conta sem e-mail de recuperação: pergunta antes da caixa (como o web). Sem ele, esquecer a senha perde a conta.
struct RecoveryPromptView: View {
    @EnvironmentObject var app: AppModel
    let session: Session
    @State private var email = ""
    @State private var busy = false
    @State private var error: String?
    @State private var sentTo: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Logo(size: 56).padding(.bottom, 28)
            Text(t("recovery.title")).font(.system(size: 26, weight: .semibold)).tracking(-0.5).multilineTextAlignment(.center)
            Text(session.user.name.isEmpty ? t("recovery.gateNote") : t("recovery.gateNoteName", ["name": session.user.name.split(separator: " ").first.map(String.init) ?? session.user.name])).font(.system(size: 14)).foregroundStyle(Palette.text3).multilineTextAlignment(.center).frame(maxWidth: 320).padding(.top, 10).padding(.bottom, 22)
            if let sentTo {
                Note(text: t("recovery.sentTo", ["email": sentTo]), tone: .secure)
                PrimaryButton(title: t("common.continue")) { app.needsRecovery = false }.padding(.top, 18)
            } else {
                ArrowField(icon: "envelope", ready: email.contains("@") && email.contains("."), busy: busy, action: save) {
                    TextField(t("recovery.emailPlaceholder"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.emailAddress).onSubmit(save)
                }
                if let error { Note(text: error, tone: .warn).padding(.top, 12) }
            }
            Spacer()
            QuietButton(title: t("ios.signOutHere")) { Task { await app.signOut() } }.padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
    }

    private func save() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { let r = try await AccountAPI.setRecovery(email.trimmingCharacters(in: .whitespaces)); sentTo = r.hint ?? email } catch { self.error = (error as? APIError)?.message ?? t("settings.recoverySaveFail") }
        }
    }
}
