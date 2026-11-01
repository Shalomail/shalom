// Conta e configurações, igual ao web (lib/profile.ts, security.ts, recovery.ts, storage.ts, agents.ts):
// mexer em segurança pede a senha de novo (a prova sai do Argon2id aqui), a troca de senha tranca a MESMA
// chave privada com a senha nova, e nada disso muda os e-mails guardados.
import CryptoKit
import Foundation
import UIKit

struct SecurityState: Decodable { var idle: Int; var pin: Bool; var totp: Bool; var recoveryLeft: Int }
struct RecoveryState: Decodable { var hint: String?; var verified: Bool }
struct Device: Decodable, Identifiable { let id: String; let created_at: Double; let last_seen: Double; let user_agent: String; let current: Bool }
struct Invite: Decodable, Identifiable { let id: String; let createdAt: Double; let usedAt: Double? }
struct AgentBox: Decodable, Identifiable { let id: String; let address: String; let name: String; let createdAt: Double; let paused: Bool }
struct ApiKey: Decodable, Identifiable { let id: String; let name: String; let hint: String; let createdAt: Double; let lastUsed: Double? }
struct StorageSummary { var used: Int; var quota: Int; var folders: [String: (count: Int, bytes: Int)] }
struct StoredRow: Decodable { let id: String; let folder: String; let size: Int; let received_at: Double; let sender: String?; let head: String; let seen: Int; let starred: Int; let pinned: Int }

enum AccountAPI {
    static let idleChoices = [5, 10, 30, 60, 300, 720, 1440, 10080, 43200]

    private static func kdf(_ salted: [String: Any]) throws -> (Data, Kdf) {
        guard let s = salted["salt"] as? String, let salt = Data(b64: s), let k = salted["kdf"] as? [String: Any],
              let d = try? JSONSerialization.data(withJSONObject: k), let kdf = try? JSONDecoder().decode(Kdf.self, from: d) else {
            throw APIError(status: 0, code: "internal", message: t("err.internal"))
        }
        return (salt, kdf)
    }

    // Prova de senha para as mudanças de segurança.
    static func proof(_ user: User, _ password: String) async throws -> String {
        let (salt, kdf) = try kdf(try await API.shared.call("/auth/salt", ["address": user.address]))
        return try await Task.detached(priority: .userInitiated) { try Keys.passwordKeys(password, salt: salt, kdf: kdf).authKey.b64 }.value
    }

    static func security() async throws -> SecurityState { try await API.shared.decode(SecurityState.self, "/profile/security") }
    static func setIdle(_ minutes: Int) async throws { try await API.shared.call("/profile/idle", ["minutes": minutes]) }
    static func setPin(_ user: User, _ password: String, _ pin: String) async throws { try await API.shared.call("/profile/pin", ["authKey": try await proof(user, password), "pin": pin]) }
    // factors: o segundo fator que a conta tiver ligado (pin, code ou recovery), para desligar ou trocar proteções.
    static func removePin(_ user: User, _ password: String, factors: [String: String] = [:]) async throws {
        try await API.shared.call("/profile/pin/delete", factors.merging(["authKey": try await proof(user, password)]) { $1 })
    }
    static func startTotp(_ user: User, _ password: String) async throws -> (secret: String, uri: String) {
        let r = try await API.shared.call("/profile/totp/start", ["authKey": try await proof(user, password)])
        return (r["secret"] as? String ?? "", r["uri"] as? String ?? "")
    }
    static func enableTotp(_ code: String) async throws -> [String] { (try await API.shared.call("/profile/totp/enable", ["code": code]))["codes"] as? [String] ?? [] }
    static func disableTotp(_ user: User, _ password: String, factors: [String: String] = [:]) async throws {
        try await API.shared.call("/profile/totp/disable", factors.merging(["authKey": try await proof(user, password)]) { $1 })
    }
    static func newRecoveryCodes(_ user: User, _ password: String, factors: [String: String] = [:]) async throws -> [String] {
        (try await API.shared.call("/profile/totp/recovery", factors.merging(["authKey": try await proof(user, password)]) { $1 }))["codes"] as? [String] ?? []
    }

    // Troca de senha: prova a atual e tranca a mesma chave privada com a nova. Nenhum e-mail muda.
    // factors: o segundo fator ligado, que a troca de senha também pede.
    static func changePassword(_ session: Session, current: String, next: String, factors: [String: String] = [:]) async throws {
        let (salt, kdf) = try kdf(try await API.shared.call("/auth/salt", ["address": session.user.address]))
        let fresh = Data.random(16)
        let (old, new) = try await Task.detached(priority: .userInitiated) {
            (try Keys.passwordKeys(current, salt: salt, kdf: kdf), try Keys.passwordKeys(next, salt: fresh, kdf: Keys.kdf))
        }.value
        let kdfObj: [String: Any] = ["alg": Keys.kdf.alg, "m": Keys.kdf.m, "t": Keys.kdf.t, "p": Keys.kdf.p]
        let body: [String: Any] = ["oldAuthKey": old.authKey.b64, "salt": fresh.b64, "kdf": kdfObj, "authKey": new.authKey.b64,
                                   "envelope": try Keys.sealEnvelope(session.secretKey, wrapKey: new.wrapKey)]
        try await API.shared.call("/profile/password", body.merging(factors) { $1 })
    }

    static func saveName(_ name: String) async throws -> String { (try await API.shared.call("/profile/name", ["name": name]))["name"] as? String ?? name }

    static func avatarURL(_ address: String, v: Double? = nil) -> URL {
        API.shared.url("/avatar/\(address.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? address)\(v.map { "?v=\(Int($0))" } ?? "")")
    }

    // Foto: quadrado do centro, 256 px, JPEG. O servidor só confere tipo e tamanho.
    static func uploadAvatar(_ image: UIImage) async throws {
        let side = min(image.size.width, image.size.height)
        let crop = CGRect(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2, width: side, height: side)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let out = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256), format: format).image { _ in
            image.draw(in: CGRect(x: -crop.minX * 256 / side, y: -crop.minY * 256 / side, width: image.size.width * 256 / side, height: image.size.height * 256 / side))
        }
        guard let data = out.jpegData(compressionQuality: 0.86) else { throw APIError(status: 0, code: "internal", message: t("err.photo_prepare")) }
        var req = URLRequest(url: API.shared.url("/profile/avatar"))
        req.httpMethod = "POST"
        req.setValue("1", forHTTPHeaderField: "x-shalom"); req.setValue(String(API.shared.slot), forHTTPHeaderField: "x-shalom-slot")
        if let cookie = API.shared.cookies.header { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        req.setValue("image/jpeg", forHTTPHeaderField: "content-type")
        req.httpBody = data
        let (body, res) = try await API.shared.session.data(for: req)
        guard (res as? HTTPURLResponse)?.statusCode == 200 else {
            let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
            throw APIError(status: 0, code: obj?["error"] as? String ?? "avatar", message: ErrorText.message(obj?["error"] as? String ?? "", obj?["message"] as? String))
        }
    }
    static func removeAvatar() async throws { try await API.shared.call("/profile/avatar/delete", [:]) }

    static func recovery() async throws -> RecoveryState { try await API.shared.decode(RecoveryState.self, "/profile/recovery") }
    static func setRecovery(_ email: String, confirm: (User, String)? = nil, factors: [String: String] = [:]) async throws -> (hint: String?, sent: Bool) {
        var body: [String: Any] = ["email": email]
        if let confirm { body["authKey"] = try await proof(confirm.0, confirm.1) }
        for (k, v) in factors { body[k] = v }
        let r = try await API.shared.call("/profile/recovery", body)
        return (r["hint"] as? String, r["sent"] as? Bool ?? true)
    }
    static func resendRecovery() async throws -> Bool { (try await API.shared.call("/profile/recovery/resend", [:]))["sent"] as? Bool ?? true }
    static func forgot(_ address: String) async throws { try await API.shared.call("/auth/forgot", ["address": address]) }

    static func devices() async throws -> [Device] {
        struct R: Decodable { let sessions: [Device] }
        return try await API.shared.decode(R.self, "/auth/sessions").sessions
    }
    static func revokeDevice(_ id: String) async throws { try await API.shared.call("/auth/sessions/revoke", ["id": id]) }

    static func invites() async throws -> [Invite] {
        struct R: Decodable { let invites: [Invite] }
        return try await API.shared.decode(R.self, "/profile/invites").invites
    }
    static func createInvite() async throws -> String { (try await API.shared.call("/profile/invites", [:]))["code"] as? String ?? "" }
    static func revokeInvite(_ id: String) async throws { try await API.shared.call("/profile/invites/revoke", ["id": id]) }

    static func agents() async throws -> [AgentBox] {
        struct R: Decodable { let agents: [AgentBox] }
        return try await API.shared.decode(R.self, "/agents").agents
    }
    static func deleteAgent(_ id: String) async throws { try await API.shared.call("/agents/delete", ["id": id]) }
    static func apiKeys() async throws -> [ApiKey] {
        struct R: Decodable { let keys: [ApiKey] }
        return try await API.shared.decode(R.self, "/apikeys").keys
    }
    static func createKey() async throws -> String { (try await API.shared.call("/apikeys", ["name": "CLI"]))["key"] as? String ?? "" }
    static func revokeKey(_ id: String) async throws { try await API.shared.call("/apikeys/revoke", ["id": id]) }

    static func storage(sort: String = "size", folder: String? = nil, after: String? = nil) async throws -> (summary: StorageSummary?, rows: [StoredRow], next: String?) {
        var q = "sort=\(sort)&dir=desc&limit=100"
        if let folder { q += "&folder=\(folder)" }
        if let after { q += "&after=\(after)" }
        let r = try await API.shared.call("/storage?\(q)")
        var summary: StorageSummary?
        if let f = r["folders"] as? [String: [String: Int]] {
            summary = StorageSummary(used: r["used"] as? Int ?? 0, quota: r["quota"] as? Int ?? 0, folders: f.mapValues { ($0["count"] ?? 0, $0["bytes"] ?? 0) })
        }
        let rows = (r["messages"] as? [[String: Any]] ?? []).compactMap { obj -> StoredRow? in
            guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
            return try? JSONDecoder().decode(StoredRow.self, from: d)
        }
        return (summary, rows, r["next"] as? String)
    }

    static func deleteAccount(_ user: User, _ password: String, confirm: String, factors: [String: String] = [:]) async throws {
        try await API.shared.call("/profile/delete", factors.merging(["authKey": try await proof(user, password), "confirm": confirm]) { $1 })
    }

    // Confirma que é a pessoa (senha e o segundo fator ligado): libera as ações perigosas por 10 minutos.
    static func confirm(_ user: User, _ password: String, factors: [String: String] = [:]) async throws {
        try await API.shared.call("/profile/confirm", factors.merging(["authKey": try await proof(user, password)]) { $1 })
    }

    static func config() async throws -> [String: Any] { try await API.shared.call("/auth/config") }
}
