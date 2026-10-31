// Ingressos de entrega com assinatura cega, igual ao shared/blind.ts (RSA com hash de domínio completo).
// O app pede ingressos já embaralhados, o servidor assina sem ver, e a entrega anônima gasta um ingresso
// que o servidor não consegue ligar a quem pediu.
import BigInt
import CryptoKit
import Foundation

struct RsaPublic: Equatable {
    let n: BigUInt
    let e: BigUInt

    init(n: BigUInt, e: BigUInt) { self.n = n; self.e = e }
    init?(wire: [String: String]) {
        guard let n = wire["n"].flatMap(Data.init(b64url:)), let e = wire["e"].flatMap(Data.init(b64url:)) else { return nil }
        self.n = BigUInt(n); self.e = BigUInt(e)
    }
    var length: Int { (n.bitWidth + 7) / 8 }
}

enum BlindError: Error { case noInverse }

enum Blind {
    static func bytes(_ v: BigUInt, length: Int) -> Data {
        let raw = v.serialize()
        return Data(count: max(0, length - raw.count)) + raw.suffix(length)
    }

    // Hash de domínio completo: SHA-256 de (mensagem || contador de 4 bytes) até cobrir o módulo com folga.
    static func fdh(_ msg: Data, _ n: BigUInt) -> BigUInt {
        let need = (n.bitWidth + 7) / 8 + 32
        var all = Data()
        var i: UInt32 = 0
        while all.count < need {
            all += Data(SHA256.hash(data: msg + Data.uint32BE(i)))
            i += 1
        }
        return BigUInt(all) % n
    }

    static func currentWeek(_ now: Date = Date()) -> UInt32 { UInt32(floor(now.timeIntervalSince1970 * 1000 / (7 * 24 * 3600 * 1000))) }

    // Ingresso: 4 bytes da semana + 32 aleatórios.
    static func newToken(week: UInt32 = currentWeek()) -> Data { Data.uint32BE(week) + Data.random(32) }

    static func blind(_ pub: RsaPublic, token: Data) -> (blinded: BigUInt, r: BigUInt) {
        while true {
            let r = BigUInt(Data.random(pub.length)) % pub.n
            guard r >= 2, r.inverse(pub.n) != nil else { continue }
            return ((fdh(token, pub.n) * r.power(pub.e, modulus: pub.n)) % pub.n, r)
        }
    }

    static func unblind(_ pub: RsaPublic, signedBlinded: BigUInt, r: BigUInt) throws -> BigUInt {
        guard let inv = r.inverse(pub.n) else { throw BlindError.noInverse }
        return (signedBlinded * inv) % pub.n
    }

    static func verify(_ pub: RsaPublic, token: Data, signature: BigUInt) -> Bool {
        signature > 0 && signature < pub.n && signature.power(pub.e, modulus: pub.n) == fdh(token, pub.n)
    }
}
