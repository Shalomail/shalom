// A chave privada da conta, guardada no Keychain só deste iPhone (não vai para backup nem para outro aparelho)
// e aberta com Face ID, Touch ID ou o código do iPhone. Sem biometria nem código, fica só enquanto o iPhone
// estiver desbloqueado. Uma entrada por conta.
import Foundation
import LocalAuthentication
import Security

enum VaultError: LocalizedError {
    case notFound, cancelled, failed(OSStatus)
    var errorDescription: String? {
        switch self {
        case .notFound: return t("err.no_session")
        case .cancelled: return t("ios.locked")
        case .failed(let s): return "Keychain \(s)"
        }
    }
}

enum Vault {
    private static let service = "com.shalomail.app.key"

    static var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType { case .faceID: return "Face ID"; case .touchID: return "Touch ID"; case .opticID: return "Optic ID"; default: return "" }
    }

    // Protegido quando o iPhone tem código: o sistema pede Face ID (ou o código) para entregar a chave.
    private static var canProtect: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    static func save(_ secret: Data, for userId: String) throws {
        delete(userId)
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId,
            kSecValueData as String: secret, kSecAttrSynchronizable as String: false,
        ]
        if canProtect, let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, nil) {
            query[kSecAttrAccessControl as String] = access
        } else {
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        }
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError.failed(status) }
    }

    static func has(_ userId: String) -> Bool {
        let ctx = LAContext()
        ctx.interactionNotAllowed = true
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId, kSecUseAuthenticationContext as String: ctx]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    // Pede Face ID (ou o código) e devolve a chave. Roda fora da thread principal: o Keychain espera a pessoa.
    static func load(_ userId: String) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            let ctx = LAContext()
            ctx.localizedReason = t("ios.unlockReason")
            var out: CFTypeRef?
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId,
                kSecReturnData as String: true, kSecUseAuthenticationContext as String: ctx,
            ]
            let status = SecItemCopyMatching(query as CFDictionary, &out)
            switch status {
            case errSecSuccess: guard let data = out as? Data else { throw VaultError.notFound }; return data
            case errSecItemNotFound: throw VaultError.notFound
            case errSecUserCanceled, errSecAuthFailed: throw VaultError.cancelled
            default: throw VaultError.failed(status)
            }
        }.value
    }

    static func delete(_ userId: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: userId] as CFDictionary)
    }
}
