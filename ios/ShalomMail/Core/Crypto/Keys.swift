// Chaves da conta, igual ao web/src/lib/keys.ts: Argon2id (128 MiB, 3 passadas) gera a base da senha; dela
// saem a authKey (prova de senha para o servidor) e a wrapKey (abre o envelope com a chave privada).
import CryptoKit
import Foundation
import Sodium

struct Kdf: Codable, Equatable {
    let alg: String
    let m: Int
    let t: Int
    let p: Int
}

enum KeysError: Error { case weakParameters, unsupportedParameters, kdfFailed, badEnvelope }

enum Keys {
    static let kdf = Kdf(alg: "argon2id", m: 131_072, t: 3, p: 1)
    private static let envelopeAAD = "shalom/envelope/v1".utf8Data

    // Os parâmetros vêm do servidor: um servidor adulterado poderia mandar parâmetros fracos para a prova de
    // senha virar um verificador barato. Mesmos limites do site. O libsodium só calcula p=1, que é o que o
    // site usa em toda conta.
    static func check(_ k: Kdf, salt: Data) throws {
        guard k.alg == "argon2id", (65_536 ... 1_048_576).contains(k.m), (3 ... 20).contains(k.t), (1 ... 8).contains(k.p), salt.count == 16 else { throw KeysError.weakParameters }
        guard k.p == 1 else { throw KeysError.unsupportedParameters }
    }

    static func passwordKeys(_ password: String, salt: Data, kdf: Kdf) throws -> (authKey: Data, wrapKey: SymmetricKey) {
        try check(kdf, salt: salt)
        let pw = Array(password.precomposedStringWithCompatibilityMapping.utf8)
        guard let master = Sodium().pwHash.hash(outputLength: 32, passwd: pw, salt: Array(salt), opsLimit: kdf.t, memLimit: kdf.m * 1024, alg: .Argon2ID13) else { throw KeysError.kdfFailed }
        let base = SymmetricKey(data: master)
        let auth = HKDF<SHA256>.deriveKey(inputKeyMaterial: base, salt: Data(), info: "shalom/auth/v1".utf8Data, outputByteCount: 32)
        let wrap = HKDF<SHA256>.deriveKey(inputKeyMaterial: base, salt: Data(), info: "shalom/wrap/v1".utf8Data, outputByteCount: 32)
        return (auth.withUnsafeBytes { Data($0) }, wrap)
    }

    // Envelope: nonce (12) | chave privada cifrada + tag. O servidor ainda passa a segunda tranca dele por
    // cima e tira antes de devolver.
    static func sealEnvelope(_ secretKey: Data, wrapKey: SymmetricKey) throws -> String {
        let box = try AES.GCM.seal(secretKey, using: wrapKey, nonce: AES.GCM.Nonce(), authenticating: envelopeAAD)
        return (Data(box.nonce) + box.ciphertext + box.tag).b64
    }

    static func openEnvelope(_ envelope: String, wrapKey: SymmetricKey) throws -> Data {
        guard let b = Data(b64: envelope).map({ [UInt8]($0) }), b.count == 12 + 32 + 16 else { throw KeysError.badEnvelope }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: Data(b[0 ..< 12])), ciphertext: Data(b[12 ..< b.count - 16]), tag: Data(b[(b.count - 16)...]))
        return try AES.GCM.open(box, using: wrapKey, authenticating: envelopeAAD)
    }
}
