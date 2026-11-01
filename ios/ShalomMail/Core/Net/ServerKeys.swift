// Chaves públicas do servidor para o remetente lacrado (a que assina certificados e a dos ingressos),
// fixadas na primeira vez, como web/src/lib/server-keys.ts. Se o servidor mandar outras, o app para de
// confiar em vez de aceitar em silêncio.
import CryptoKit
import Foundation

enum ServerKeysError: LocalizedError {
    case changed
    var errorDescription: String? { t("err.server_keys") }
}

actor ServerKeys {
    static let shared = ServerKeys()
    private static let pinKey = "shalom-server-keys"
    // Impressão (SHA-256 de "certKey|n|e") das chaves do shalomail.com, embutida no app como no CLI: mesmo num
    // iPhone novo, sem nada fixado, um servidor trocado ou uma conexão interceptada não passa por remetente
    // conferido. A migração de conta mantém as mesmas chaves.
    private static let builtIn = ["https://shalomail.com": "7d5d529619e39c71e1045658d30e015b8f14d25264e7712c437db5298896f974"]
    private var loaded: (cert: Data, token: RsaPublic)?

    func get() async throws -> (cert: Data, token: RsaPublic) {
        if let loaded { return loaded }
        let config = try await API.shared.call("/auth/config")
        guard let certKey = config["certKey"] as? String, let cert = Data(b64: certKey),
              let wire = config["tokenKey"] as? [String: String], let token = RsaPublic(wire: wire) else { throw APIError(status: 0, code: "internal", message: t("err.internal")) }
        let now = "\(certKey)|\(wire["n"] ?? "")|\(wire["e"] ?? "")"
        if let fingerprint = Self.builtIn[API.shared.base.absoluteString],
           SHA256.hash(data: Data(now.utf8)).map({ String(format: "%02x", $0) }).joined() != fingerprint { throw ServerKeysError.changed }
        if let pinned = UserDefaults.standard.string(forKey: Self.pinKey) {
            guard pinned == now else { throw ServerKeysError.changed }
        } else {
            UserDefaults.standard.set(now, forKey: Self.pinKey)
        }
        loaded = (cert, token)
        return (cert, token)
    }
}
