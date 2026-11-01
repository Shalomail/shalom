// Bytes: base64 (padrão e de URL), concatenação e inteiro de 32 bits big-endian, do jeito que o site usa
// (shared/seal.ts, shared/blind.ts).
import Foundation

extension Data {
    init?(b64 string: String) { self.init(base64Encoded: string) }
    var b64: String { base64EncodedString() }

    init?(b64url string: String) {
        var s = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        s += String(repeating: "=", count: (4 - s.count % 4) % 4)
        self.init(base64Encoded: s)
    }
    var b64url: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func uint32BE(_ v: UInt32) -> Data { Data([UInt8(v >> 24 & 0xff), UInt8(v >> 16 & 0xff), UInt8(v >> 8 & 0xff), UInt8(v & 0xff)]) }
    func uint32BE(at offset: Int) -> UInt32 {
        let b = [UInt8](self[startIndex + offset ..< startIndex + offset + 4])
        return UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])
    }

    static func random(_ count: Int) -> Data {
        var d = Data(count: count)
        let status = d.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!) }
        // Sal, chaves e ingressos dependem disso: sem aleatoriedade de verdade, melhor parar do que seguir.
        precondition(status == errSecSuccess, "SecRandomCopyBytes falhou")
        return d
    }
}

extension String {
    var utf8Data: Data { Data(utf8) }
}
