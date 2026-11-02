// Chaves públicas do servidor para o remetente lacrado (a que assina certificados e a dos ingressos). No
// shalomail.com vale a impressão embutida no app; em outro servidor (só nos testes, com `-api`), as chaves
// ficam fixadas na primeira vez, uma por endereço, como no CLI. Se o servidor mandar outras, o app para de
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
        let base = API.shared.base.absoluteString
        if let fingerprint = Self.builtIn[base] {
            guard SHA256.hash(data: Data(now.utf8)).map({ String(format: "%02x", $0) }).joined() == fingerprint else { throw ServerKeysError.changed }
            // Versões antigas guardavam uma fixação só, de qualquer servidor: a do servidor de teste travava o
            // shalomail.com no mesmo aparelho.
            UserDefaults.standard.removeObject(forKey: Self.pinKey)
        } else {
            let key = "\(Self.pinKey)|\(base)"
            if let pinned = UserDefaults.standard.string(forKey: key) {
                guard pinned == now else { throw ServerKeysError.changed }
            } else {
                UserDefaults.standard.set(now, forKey: key)
            }
        }
        loaded = (cert, token)
        return (cert, token)
    }
}
