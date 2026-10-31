// A criptografia do app contra a do site: os vetores saem de scripts/ios-vectors.ts (código TypeScript do
// site) e aqui o Swift precisa abrir, conferir e calcular igual. E o caminho de volta: o que o Swift lacra,
// o próprio Swift abre (o site abrindo o que o app lacra fica no teste de ponta a ponta).
import BigInt
import XCTest
@testable import ShalomMail

final class CryptoVectorTests: XCTestCase {
    struct Vectors: Decodable {
        struct SealCase: Decodable { let purpose: String; let sealed: String }
        struct FP: Decodable { let address: String; let publicKey: String; let value: String }
        struct BlindCase: Decodable { let pub: [String: String]; let token: String; let signature: String }
        struct ThreadCase: Decodable { let references: String; let inReplyTo: String; let messageId: String; let key: String }
        let recipientSecret, recipientPub, senderPub, serverPub: String
        let password, salt, authKey, envelope: String
        let kdf: Kdf
        let text: String
        let seals: [SealCase]
        let authSeal, sealedSender: String
        let sealedSenderReceivedAt: Double
        let sealedSenderAddress: String
        let mime, packed, bodyHash: String
        let fingerprint: FP
        let blind: BlindCase
        let threads: [ThreadCase]
    }

    var v: Vectors!
    func d(_ s: String) -> Data { Data(b64: s)! }

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "vectors", withExtension: "json"))
        v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    func testPublicKeyMatches() throws {
        XCTAssertEqual(try Seal.publicKey(of: d(v.recipientSecret)), d(v.recipientPub))
    }

    func testPasswordKeysAndEnvelope() throws {
        let keys = try Keys.passwordKeys(v.password, salt: d(v.salt), kdf: v.kdf)
        XCTAssertEqual(keys.authKey, d(v.authKey), "authKey do Argon2id + HKDF igual ao do site")
        XCTAssertEqual(try Keys.openEnvelope(v.envelope, wrapKey: keys.wrapKey), d(v.recipientSecret), "envelope do site abre no app")
        let again = try Keys.sealEnvelope(d(v.recipientSecret), wrapKey: keys.wrapKey)
        XCTAssertEqual(try Keys.openEnvelope(again, wrapKey: keys.wrapKey), d(v.recipientSecret))
    }

    func testWeakKdfRefused() {
        XCTAssertThrowsError(try Keys.check(Kdf(alg: "argon2id", m: 1024, t: 1, p: 1), salt: d(v.salt)))
    }

    func testOpenSiteSeals() throws {
        for c in v.seals {
            XCTAssertEqual(try Seal.open(d(v.recipientSecret), d(c.sealed), SealPurpose(rawValue: c.purpose)!), d(v.text), "lacre \(c.purpose)")
        }
        XCTAssertThrowsError(try Seal.open(d(v.recipientSecret), d(v.seals[0].sealed), .raw), "propósito errado não abre")
    }

    func testOpenSiteAuthSeal() throws {
        XCTAssertEqual(try Seal.openAuth(d(v.recipientSecret), senderPublic: d(v.senderPub), d(v.authSeal), .raw), d(v.text))
        XCTAssertThrowsError(try Seal.openAuth(d(v.recipientSecret), senderPublic: d(v.recipientPub), d(v.authSeal), .raw), "outro remetente não abre")
    }

    func testSealedSenderFromSite() throws {
        let r = try Sender.open(d(v.recipientSecret), d(v.sealedSender), .head, serverPublic: d(v.serverPub), receivedAt: v.sealedSenderReceivedAt)
        XCTAssertEqual(r.payload, d(v.text))
        XCTAssertEqual(r.address, v.sealedSenderAddress)
        XCTAssertEqual(r.publicKey, v.senderPub)
        XCTAssertThrowsError(try Sender.open(d(v.recipientSecret), d(v.sealedSender), .head, serverPublic: d(v.serverPub), receivedAt: v.sealedSenderReceivedAt + 30 * 86_400_000), "fora da validade")
        XCTAssertThrowsError(try Sender.open(d(v.recipientSecret), d(v.sealedSender), .head, serverPublic: d(v.senderPub), receivedAt: v.sealedSenderReceivedAt), "assinatura de outra chave")
    }

    func testSwiftRoundTrips() throws {
        let me = Seal.newKeyPair(), them = Seal.newKeyPair()
        let msg = "Mensagem do iPhone".utf8Data
        XCTAssertEqual(try Seal.open(me.secret, try Seal.seal(to: me.public, msg, .raw), .raw), msg)
        XCTAssertEqual(try Seal.openAuth(me.secret, senderPublic: them.public, try Seal.sealAuth(to: me.public, senderSecret: them.secret, msg, .head), .head), msg)
    }

    func testUnpackSitePackAndHash() throws {
        XCTAssertEqual(try Pack.unpack(d(v.packed)), d(v.mime))
        XCTAssertEqual(Pack.bodyHash(d(v.packed)), v.bodyHash)
        let mine = try Pack.pack(d(v.mime))
        XCTAssertEqual(mine.count, d(v.packed).count, "mesmo degrau de tamanho do site")
        XCTAssertEqual(try Pack.unpack(mine), d(v.mime))
        XCTAssertEqual(try Pack.unpack(d(v.mime)), d(v.mime), "formato antigo (sem moldura) passa como veio")
    }

    func testFingerprint() {
        XCTAssertEqual(Fingerprint.of(address: v.fingerprint.address, publicKey: d(v.fingerprint.publicKey)), v.fingerprint.value)
    }

    func testBlindSignatureFromSite() throws {
        let pub = try XCTUnwrap(RsaPublic(wire: v.blind.pub))
        let sig = BigUInt(try XCTUnwrap(Data(b64url: v.blind.signature)))
        XCTAssertTrue(Blind.verify(pub, token: d(v.blind.token), signature: sig), "ingresso assinado no site confere no app")
        var other = d(v.blind.token); other[other.count - 1] ^= 1
        XCTAssertFalse(Blind.verify(pub, token: other, signature: sig))
        let token = Blind.newToken()
        let b = Blind.blind(pub, token: token)
        XCTAssertTrue(b.blinded < pub.n && b.r > 1)
    }

    func testThreadKeyMatchesSite() {
        for c in v.threads {
            XCTAssertEqual(Head.threadKey(references: c.references, inReplyTo: c.inReplyTo, messageId: c.messageId), c.key, "marca da conversa de \(c)")
        }
    }

    func testBuiltMimeParsesBack() throws {
        var o = Outgoing(to: [Person(name: "Lia Moraes", address: "lia@shalomail.com")], subject: "Olá, ação! 漢字")
        o.text = "Linha 1\nLinha 2 com acentuação: ç ã é"
        o.attachments = [OutgoingAttachment(filename: "nota çã.txt", type: "text/plain", content: Data("conteúdo".utf8))]
        let mime = MIMEBuilder.build(from: Person(name: "Marina Duarte", address: "marina@shalomail.com"), o, text: o.text, html: MIMEBuilder.textToHtml(o.text, quoted: nil),
                                     messageId: "<m1@shalomail.com>", date: Date(timeIntervalSince1970: 1_793_000_000), includeBcc: true)
        let e = MIME.parse(mime)
        XCTAssertEqual(e.subject, o.subject)
        XCTAssertEqual(e.from?.address, "marina@shalomail.com")
        XCTAssertEqual(e.from?.name, "Marina Duarte")
        XCTAssertEqual(e.to.first?.address, "lia@shalomail.com")
        XCTAssertEqual(e.text, o.text)
        XCTAssertTrue(e.html?.contains("Linha 2 com acentuação") == true)
        XCTAssertEqual(e.files.first?.filename, "nota çã.txt")
        XCTAssertEqual(e.files.first?.data, Data("conteúdo".utf8))
        let head = Head.of(e, sentAt: Date())
        XCTAssertEqual(head.t, Head.threadKey(references: nil, inReplyTo: nil, messageId: "<m1@shalomail.com>"))
        XCTAssertEqual(head.attachments, 1)
    }
}
