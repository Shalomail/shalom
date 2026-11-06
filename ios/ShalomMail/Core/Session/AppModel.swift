// Sessão no iPhone, igual ao web/src/lib/session.ts: a senha vira a prova (Argon2id) e a chave que abre o
// envelope; o servidor só entrega o envelope com a prova certa (e o PIN ou o código, se ligados). A chave
// privada abre aqui, é conferida contra a pública que o servidor diz ser da conta e fica no Vault.
import CryptoKit
import Foundation
import SwiftUI

struct Session {
    let user: User
    let secretKey: Data
}

// Senha certa numa conta com PIN e/ou duas etapas: a chave do envelope espera aqui, em memória.
struct SecondStep {
    let ticket: String
    let pin: Bool
    let totp: Bool
    let wrapKey: SymmetricKey
    let remember: Bool
}

enum KeyMismatchError: LocalizedError { case mismatch; var errorDescription: String? { t("err.key_mismatch") } }

@MainActor
final class AppModel: ObservableObject {
    enum Phase { case starting, signedOut, locked(User), open(Session) }

    @Published var phase: Phase = .starting
    var isOpen: Bool { if case .open = phase { return true } else { return false } }
    // A tela de entrar (e o cadastro que abre dela) é sempre clara; o tema escolhido vale da caixa em diante.
    var isSignedOut: Bool { if case .signedOut = phase { return true } else { return false } }
    @Published var notice: String?
    // Conta sem e-mail de recuperação: a pergunta vem antes da caixa, como no web.
    @Published var needsRecovery = false
    // Entrando com mais uma conta: dá para voltar para a que estava aberta.
    @Published var addingFrom: Int?
    // Tela coberta no seletor de apps (a miniatura não mostra e-mail).
    @Published var covered = false
    // Link do e-mail ou do terminal aberto no app (senha nova, conectar o CLI).
    @Published var link: IncomingLink?

    private var idleMinutes = 43_200
    private var backgroundAt: Date?

    nonisolated static let domain = "shalomail.com"

    init() {
        // Anexos abertos que ficaram de uma vez anterior (o app fechou com a conversa aberta) e chave guardada
        // sem Face ID nem código por uma versão anterior num iPhone sem código: nada disso fica.
        AttachmentTemp.clear()
        Vault.dropUnprotected()
        Reauth.shared.user = { [weak self] in self?.session?.user }
        NotificationCenter.default.addObserver(forName: .signedOut, object: nil, queue: .main) { [weak self] note in
            let message = (note.object as? APIError)?.message
            Task { @MainActor in self?.serverEnded(message) }
        }
    }

    var session: Session? { if case .open(let s) = phase { return s }; return nil }

    private var slot: Int {
        get { Accounts.currentSlot }
        set { Accounts.currentSlot = newValue; API.shared.slot = newValue }
    }

    func start() async {
        API.shared.slot = slot
        guard let stored = Accounts.current else { phase = .signedOut; return }
        var user = stored.user
        do {
            let me = try await API.shared.call("/auth/me")
            if let u = me["user"] as? [String: Any], let fresh = Self.user(u) { user = fresh; Accounts.keep(fresh, slot: slot) }
        } catch let e as APIError where e.status == 401 || e.status == 403 {
            Vault.delete(stored.user.id); Accounts.drop(slot: slot)
            phase = .signedOut; return
        } catch {
            // Sem rede: dá para destrancar e ler o que já estiver no aparelho quando a rede voltar.
        }
        guard Vault.has(user.id) else {
            _ = try? await API.shared.call("/auth/logout", [:])
            Accounts.drop(slot: slot)
            phase = .signedOut
            return
        }
        phase = .locked(user)
    }

    func unlock(_ user: User) async throws {
        let secret = try await Vault.load(user.id)
        try Self.checkOwnKey(user, secret)
        open(Session(user: user, secretKey: secret))
    }

    private func open(_ session: Session) {
        phase = .open(session)
        addingFrom = nil
        Task {
            // Certificado, ingressos e chaves de contatos de outra sessão não passam para esta.
            await Outbox.shared.forget()
            await Push.shared.accountOpened(session.user)
            if let sec = try? await AccountAPI.security() { idleMinutes = sec.idle }
            if let rec = try? await AccountAPI.recovery() { needsRecovery = rec.hint == nil }
        }
    }

    func setIdle(_ minutes: Int) { idleMinutes = minutes }

    // Trava do app (Configurações, "Trancar o app"): fora do app por mais tempo que isso, volta pedindo o Face
    // ID. 0 = ao sair. Padrão de 5 minutos; antes a trava só vinha com a inatividade da conta (30 dias).
    static let lockKey = "shalom-lock-minutes"
    static let lockChoices = [0, 1, 5, 15, 60]
    private var lockMinutes: Int { UserDefaults.standard.object(forKey: Self.lockKey) as? Int ?? 5 }

    // Fora do app por mais tempo que o escolhido em "Sair sozinho depois de": a conta fecha (tranca, se a
    // chave estiver guardada; senão, sai). Antes disso, a trava do app tranca (a chave fica, o Face ID abre).
    func wentBackground() { backgroundAt = Date(); covered = true }
    func becameInactive() { covered = true }
    func cameBack() {
        covered = false
        guard let at = backgroundAt else { return }
        backgroundAt = nil
        guard case .open(let s) = phase else { return }
        let away = Date().timeIntervalSince(at)
        // Sem a chave guardada (não pediu para lembrar, ou iPhone sem código) não há como trancar com o Face
        // ID: no tempo da trava a conta sai, em vez de deixar a chave na memória até a inatividade da conta.
        if away > Double(idleMinutes) * 60 || away >= Double(lockMinutes) * 60 {
            if Vault.has(s.user.id) { lock() } else { Task { await signOut() } }
        }
    }

    // Várias contas: cada uma na sua vaga, com o próprio cookie de sessão.
    var accounts: [StoredAccount] { Accounts.all }

    func switchTo(_ slot: Int) {
        guard slot != Accounts.currentSlot, let acc = Accounts.all.first(where: { $0.slot == slot }) else { return }
        Live.shared.stop()
        Mailbox.shared.forget()
        AttachmentTemp.clear()
        Task { await Outbox.shared.forget() }
        self.slot = slot
        phase = .locked(acc.user)
    }

    func addAccount() {
        guard let free = Accounts.freeSlot() else { return }
        Live.shared.stop()
        Mailbox.shared.forget()
        AttachmentTemp.clear()
        Task { await Outbox.shared.forget() }
        addingFrom = Accounts.currentSlot
        slot = free
        phase = .signedOut
    }

    func cancelAdding() {
        guard let from = addingFrom, let acc = Accounts.all.first(where: { $0.slot == from }) else { return }
        addingFrom = nil
        slot = from
        phase = .locked(acc.user)
    }

    // Conta nova: o par de chaves nasce aqui, a chave privada vai trancada pela senha (envelope) e só a
    // pública e a prova de senha chegam ao servidor.
    func signUp(local: String, name: String, password: String, turnstile: String, invite: String?) async throws {
        let salt = Data.random(16)
        let pair = Seal.newKeyPair()
        let keys = try await Task.detached(priority: .userInitiated) { try Keys.passwordKeys(password, salt: salt, kdf: Keys.kdf) }.value
        var body: [String: Any] = [
            "address": local, "name": name, "turnstile": turnstile, "website": "", "lang": L10n.shared.lang,
            "salt": salt.b64, "kdf": ["alg": Keys.kdf.alg, "m": Keys.kdf.m, "t": Keys.kdf.t, "p": Keys.kdf.p],
            "authKey": keys.authKey.b64, "publicKey": pair.public.b64, "envelope": try Keys.sealEnvelope(pair.secret, wrapKey: keys.wrapKey),
        ]
        if let invite { body["invite"] = invite }
        let res = try await API.shared.call("/auth/signup", body)
        guard let u = res["user"] as? [String: Any], let user = Self.user(u) else { throw APIError(status: 0, code: "internal", message: t("err.internal")) }
        try Self.checkOwnKey(user, pair.secret)
        try Vault.save(pair.secret, for: user.id)
        Accounts.keep(user, slot: slot)
        open(Session(user: user, secretKey: pair.secret))
        needsRecovery = true
    }

    func handle(_ url: URL) {
        #if !DEBUG
        // Na versão da loja só valem os links https://shalomail.com (ligados ao domínio pelo
        // apple-app-site-association). O esquema shalommail:// qualquer site ou app consegue chamar; fica só
        // para os testes.
        guard url.scheme == "https" else { return }
        #endif
        guard let l = IncomingLink(url) else { return }
        if case .confirm(let token) = l {
            Task {
                do { try await API.shared.call("/auth/recovery/confirm", ["token": token]); notice = t("recovery.confirmed"); if session != nil { needsRecovery = false } }
                catch { notice = (error as? APIError)?.message ?? t("recovery.confirmFail") }
            }
            return
        }
        link = l
    }

    // Senha nova pelo link: a sessão entra na vaga desta conta, se ela já estiver no iPhone, ou numa vaga livre;
    // nunca por cima de outra conta aberta. A chave privada é nova (os e-mails antigos não voltam).
    func resetPassword(token: String, address: String, password: String, pin: String?, code: String?, recovery: String?) async throws {
        if let own = Accounts.all.first(where: { $0.user.address == address }) { slot = own.slot }
        else if Accounts.current != nil, let free = Accounts.freeSlot() { slot = free }
        let salt = Data.random(16)
        let pair = Seal.newKeyPair()
        let keys = try await Task.detached(priority: .userInitiated) { try Keys.passwordKeys(password, salt: salt, kdf: Keys.kdf) }.value
        var body: [String: Any] = [
            "token": token, "salt": salt.b64, "kdf": ["alg": Keys.kdf.alg, "m": Keys.kdf.m, "t": Keys.kdf.t, "p": Keys.kdf.p],
            "authKey": keys.authKey.b64, "publicKey": pair.public.b64, "envelope": try Keys.sealEnvelope(pair.secret, wrapKey: keys.wrapKey),
        ]
        if let pin { body["pin"] = pin }
        if let code { body["code"] = code }
        if let recovery { body["recovery"] = recovery }
        let res = try await API.shared.call("/auth/reset", body)
        guard let u = res["user"] as? [String: Any], let user = Self.user(u) else { throw APIError(status: 0, code: "internal", message: t("err.internal")) }
        try Self.checkOwnKey(user, pair.secret)
        Mailbox.shared.forget()
        try Vault.save(pair.secret, for: user.id)
        Accounts.keep(user, slot: slot)
        open(Session(user: user, secretKey: pair.secret))
    }

    func renamed(_ name: String) {
        guard case .open(let s) = phase else { return }
        var u = s.user; u.name = name
        Accounts.keep(u, slot: slot)
        phase = .open(Session(user: u, secretKey: s.secretKey))
    }

    static func user(_ obj: [String: Any]) -> User? {
        guard let id = obj["id"] as? String, let address = obj["address"] as? String, let pub = obj["publicKey"] as? String else { return nil }
        return User(id: id, address: address, name: obj["name"] as? String ?? "", publicKey: pub)
    }

    // A chave pública que o servidor diz ser minha tem que sair da minha chave privada; se não sair, alguém
    // trocou a chave no banco para ler o que chega. Não abre a caixa.
    static func checkOwnKey(_ user: User, _ secret: Data) throws {
        guard (try? Seal.publicKey(of: secret).b64) == user.publicKey else { throw KeyMismatchError.mismatch }
    }

    static func fullAddress(_ input: String) -> String {
        let s = input.trimmingCharacters(in: .whitespaces).lowercased()
        return s.contains("@") ? s : "\(s)@\(domain)"
    }

    // Senha certa: abre a caixa, ou devolve a segunda etapa (PIN e/ou código).
    // turnstile: depois de 3 senhas erradas num aparelho novo, o servidor pede a verificação contra robôs.
    func signIn(address: String, password: String, remember: Bool, turnstile: String? = nil) async throws -> SecondStep? {
        let full = Self.fullAddress(address)
        let salted = try await API.shared.call("/auth/salt", ["address": full])
        guard let saltB64 = salted["salt"] as? String, let salt = Data(b64: saltB64), let k = salted["kdf"] as? [String: Any],
              let kdfData = try? JSONSerialization.data(withJSONObject: k), let kdf = try? JSONDecoder().decode(Kdf.self, from: kdfData) else {
            throw APIError(status: 0, code: "internal", message: t("err.internal"))
        }
        let keys = try await Task.detached(priority: .userInitiated) { try Keys.passwordKeys(password, salt: salt, kdf: kdf) }.value
        var body: [String: Any] = ["address": full, "authKey": keys.authKey.b64]
        if let turnstile { body["turnstile"] = turnstile }
        let res = try await API.shared.call("/auth/login", body)
        if let ticket = res["ticket"] as? String {
            let second = res["second"] as? [String: Any]
            return SecondStep(ticket: ticket, pin: second?["pin"] as? Bool ?? false, totp: second?["totp"] as? Bool ?? false, wrapKey: keys.wrapKey, remember: remember)
        }
        try finish(res, wrapKey: keys.wrapKey, remember: remember)
        return nil
    }

    func signInSecond(_ step: SecondStep, pin: String? = nil, code: String? = nil, recovery: String? = nil) async throws {
        var body: [String: Any] = ["ticket": step.ticket]
        if let pin { body["pin"] = pin }
        if let code { body["code"] = code }
        if let recovery { body["recovery"] = recovery }
        try finish(try await API.shared.call("/auth/login/second", body), wrapKey: step.wrapKey, remember: step.remember)
    }

    private func finish(_ res: [String: Any], wrapKey: SymmetricKey, remember: Bool) throws {
        guard let u = res["user"] as? [String: Any], let user = Self.user(u), let envelope = res["envelope"] as? String else {
            throw APIError(status: 0, code: "internal", message: t("err.internal"))
        }
        let secret = try Keys.openEnvelope(envelope, wrapKey: wrapKey)
        try Self.checkOwnKey(user, secret)
        if remember { try Vault.save(secret, for: user.id) } else { Vault.delete(user.id) }
        Accounts.keep(user, slot: slot)
        open(Session(user: user, secretKey: secret))
    }

    func signOut() async {
        AttachmentTemp.clear()
        Live.shared.stop()
        await Push.shared.remove()
        _ = try? await API.shared.call("/auth/logout", [:])
        dropCurrent()
        await Outbox.shared.forget()
        if let next = Accounts.all.first { slot = next.slot; phase = .locked(next.user) } else { phase = .signedOut; Push.shared.badge(0) }
    }

    private func dropCurrent() {
        if let acc = Accounts.current { Vault.delete(acc.user.id) }
        Accounts.drop(slot: slot)
        Mailbox.shared.forget()
    }

    // A sessão acabou no servidor (inatividade, saiu em outro aparelho, conta suspensa).
    private func serverEnded(_ message: String?) {
        guard session != nil else { return }
        dropCurrent()
        AttachmentTemp.clear()
        Task { await Outbox.shared.forget() }
        notice = message
        phase = .signedOut
    }

    func lock() {
        if case .open(let s) = phase, Vault.has(s.user.id) { Mailbox.shared.forget(); AttachmentTemp.clear(); phase = .locked(s.user) }
    }
}
