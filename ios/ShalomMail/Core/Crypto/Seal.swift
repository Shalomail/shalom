// Lacre de mensagem, igual ao shared/seal.ts: X25519 efêmero + HKDF-SHA256 + AES-256-GCM.
//
// v1 (anônimo):      1 | chave pública efêmera (32) | nonce (12) | texto cifrado + tag (16)
// v2 (autenticado):  2 | igual, com o DH entre a chave fixa de quem envia e a de quem recebe somado ao
//                    efêmero (como o modo Auth do HPKE)
import CryptoKit
import Foundation

enum SealPurpose: String { case head, raw, cert }

enum SealError: Error { case invalid }

enum Seal {
    static let version: UInt8 = 1
    static let authVersion: UInt8 = 2
    private static let minLength = 1 + 32 + 12 + 16

    static func newKeyPair() -> (secret: Data, public: Data) {
        let key = Curve25519.KeyAgreement.PrivateKey()
        return (key.rawRepresentation, key.publicKey.rawRepresentation)
    }

    static func publicKey(of secret: Data) throws -> Data {
        try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secret).publicKey.rawRepresentation
    }

    static func dh(_ secret: Data, _ peer: Data) throws -> Data {
        let shared = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: secret)
            .sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: peer))
        return shared.withUnsafeBytes { Data($0) }
    }

    static func hkdf(_ ikm: Data, salt: Data, info: Data) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: info, outputByteCount: 32)
    }

    private static func info(_ purpose: SealPurpose) -> Data { "shalom/v1/\(purpose.rawValue)".utf8Data }
    private static func authInfo(_ purpose: SealPurpose) -> Data { "shalom/v2/\(purpose.rawValue)".utf8Data }

    // Separa versão, efêmera, nonce, cifrado e tag.
    private static func parts(_ sealed: Data, version v: UInt8) throws -> (eph: Data, box: AES.GCM.SealedBox) {
        let b = [UInt8](sealed)
        guard b.count >= minLength, b[0] == v else { throw SealError.invalid }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: Data(b[33 ..< 45])), ciphertext: Data(b[45 ..< b.count - 16]), tag: Data(b[(b.count - 16)...]))
        return (Data(b[1 ..< 33]), box)
    }

    private static func pack(_ v: UInt8, _ eph: Data, _ box: AES.GCM.SealedBox) -> Data {
        Data([v]) + eph + Data(box.nonce) + box.ciphertext + box.tag
    }

    static func seal(to recipient: Data, _ plaintext: Data, _ purpose: SealPurpose) throws -> Data {
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let ephPub = eph.publicKey.rawRepresentation
        let key = hkdf(try dh(eph.rawRepresentation, recipient), salt: ephPub + recipient, info: info(purpose))
        return pack(version, ephPub, try AES.GCM.seal(plaintext, using: key, nonce: AES.GCM.Nonce(), authenticating: info(purpose)))
    }

    static func open(_ secret: Data, _ sealed: Data, _ purpose: SealPurpose) throws -> Data {
        let (eph, box) = try parts(sealed, version: version)
        let key = hkdf(try dh(secret, eph), salt: eph + (try publicKey(of: secret)), info: info(purpose))
        return try AES.GCM.open(box, using: key, authenticating: info(purpose))
    }

    static func sealJSON<T: Encodable>(to recipient: Data, _ value: T) throws -> Data {
        try seal(to: recipient, try JSONEncoder().encode(value), .head)
    }

    static func openJSON<T: Decodable>(_ secret: Data, _ sealed: Data, as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: try open(secret, sealed, .head))
    }

    // v2: só quem tem a chave privada do remetente produz um lacre que abre com a chave pública dele.
    private static func authKey(_ dh1: Data, _ dh2: Data, eph: Data, sender: Data, recipient: Data, _ purpose: SealPurpose) -> SymmetricKey {
        hkdf(dh1 + dh2, salt: eph + sender + recipient, info: authInfo(purpose))
    }

    static func sealAuth(to recipient: Data, senderSecret: Data, _ plaintext: Data, _ purpose: SealPurpose) throws -> Data {
        let eph = Curve25519.KeyAgreement.PrivateKey()
        let ephPub = eph.publicKey.rawRepresentation
        let key = authKey(try dh(eph.rawRepresentation, recipient), try dh(senderSecret, recipient), eph: ephPub, sender: try publicKey(of: senderSecret), recipient: recipient, purpose)
        let aad = Data([authVersion]) + authInfo(purpose)
        return pack(authVersion, ephPub, try AES.GCM.seal(plaintext, using: key, nonce: AES.GCM.Nonce(), authenticating: aad))
    }

    static func openAuth(_ recipientSecret: Data, senderPublic: Data, _ sealed: Data, _ purpose: SealPurpose) throws -> Data {
        let (eph, box) = try parts(sealed, version: authVersion)
        let key = authKey(try dh(recipientSecret, eph), try dh(recipientSecret, senderPublic), eph: eph, sender: senderPublic, recipient: try publicKey(of: recipientSecret), purpose)
        return try AES.GCM.open(box, using: key, authenticating: Data([authVersion]) + authInfo(purpose))
    }
}
