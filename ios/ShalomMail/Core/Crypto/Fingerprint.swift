// Impressão digital de uma chave, igual ao shared/fingerprint.ts: 30 dígitos em 6 grupos.
// SHA-256("shalom/fp/v1" || 0 || endereço || 0 || chave pública), 6 blocos de 5 bytes, cada um mod 100000.
import CryptoKit
import Foundation

enum Fingerprint {
    static func of(address: String, publicKey: Data) -> String {
        let data = "shalom/fp/v1".utf8Data + Data([0]) + address.lowercased().utf8Data + Data([0]) + publicKey
        let h = [UInt8](SHA256.hash(data: data))
        return (0 ..< 6).map { i in
            let n = (0 ..< 5).reduce(UInt64(0)) { $0 * 256 + UInt64(h[i * 5 + $1]) }
            return String(format: "%05llu", n % 100_000)
        }.joined(separator: " ")
    }
}
