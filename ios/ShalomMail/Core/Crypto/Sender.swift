// Remetente lacrado, igual ao shared/sender.ts: o servidor assina (Ed25519) um certificado curto "este
// endereço tem esta chave"; quem envia põe o certificado num lacre anônimo e tranca a mensagem com o lacre
// autenticado (v2). Quem recebe confere a assinatura, a validade e o lacre com a chave do certificado.
//
// Formato: 3 | tamanho do certificado lacrado (2 bytes) | certificado lacrado (anônimo) | mensagem (lacre v2)
import CryptoKit
import Foundation

struct Cert: Codable { let a: String; let k: String; let i: Double; let e: Double }
struct SignedCert: Codable { let c: String; let s: String }

enum SenderError: Error { case badSignature, malformed, expired, notSealedSender }

enum Sender {
    static let sealedSender: UInt8 = 3

    static func verify(_ signed: SignedCert, serverPublic: Data) throws -> Cert {
        guard let bytes = Data(b64: signed.c), let sig = Data(b64: signed.s) else { throw SenderError.malformed }
        guard try Curve25519.Signing.PublicKey(rawRepresentation: serverPublic).isValidSignature(sig, for: bytes) else { throw SenderError.badSignature }
        guard let cert = try? JSONDecoder().decode(Cert.self, from: bytes) else { throw SenderError.malformed }
        return cert
    }

    static func isSealedSender(_ blob: Data) -> Bool { blob.first == sealedSender }

    static func seal(to recipient: Data, senderSecret: Data, cert: SignedCert, _ payload: Data, _ purpose: SealPurpose) throws -> Data {
        let outer = try Seal.seal(to: recipient, try JSONEncoder().encode(cert), .cert)
        let inner = try Seal.sealAuth(to: recipient, senderSecret: senderSecret, payload, purpose)
        return Data([sealedSender, UInt8(outer.count >> 8), UInt8(outer.count & 0xff)]) + outer + inner
    }

    // receivedAt em milissegundos, como o servidor guarda.
    static func open(_ recipientSecret: Data, _ blob: Data, _ purpose: SealPurpose, serverPublic: Data, receivedAt: Double) throws -> (payload: Data, address: String, publicKey: String) {
        let b = [UInt8](blob)
        guard b.count >= 4, b[0] == sealedSender else { throw SenderError.notSealedSender }
        let len = Int(b[1]) << 8 | Int(b[2])
        guard 3 + len < b.count else { throw SenderError.malformed }
        let signed = try JSONDecoder().decode(SignedCert.self, from: try Seal.open(recipientSecret, Data(b[3 ..< 3 + len]), .cert))
        let cert = try verify(signed, serverPublic: serverPublic)
        guard receivedAt <= cert.e + 300_000, receivedAt >= cert.i - 300_000 else { throw SenderError.expired }
        guard let senderPub = Data(b64: cert.k) else { throw SenderError.malformed }
        let payload = try Seal.openAuth(recipientSecret, senderPublic: senderPub, Data(b[(3 + len)...]), purpose)
        return (payload, cert.a.lowercased(), cert.k)
    }
}
