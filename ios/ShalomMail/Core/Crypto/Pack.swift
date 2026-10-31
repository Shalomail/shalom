// Empacotamento do e-mail antes do lacre, igual ao shared/pack.ts: gzip, com moldura e preenchimento até um
// degrau de tamanho (o servidor vê o tamanho do lacre; o degrau esconde o tamanho exato).
//
// Moldura: 00 'S' 'H' 01 | tamanho do gzip (4 bytes) | gzip | zeros até o degrau.
// Formatos antigos continuam abrindo: gzip puro (1f 8b) ou a mensagem como veio.
import CryptoKit
import Foundation

enum PackError: Error { case corrupt }

enum Pack {
    private static let magic: [UInt8] = [0x00, 0x53, 0x48, 0x01]

    static func step(_ n: Int) -> Int { max(256, 1 << max(0, Int(ceil(log2(Double(n)))) - 4)) }

    static func pack(_ bytes: Data) throws -> Data {
        let gz = try Gzip.compress(bytes)
        let used = magic.count + 4 + gz.count
        let s = step(used)
        var out = Data(magic) + Data.uint32BE(UInt32(gz.count)) + gz
        out.append(Data(count: (used + s - 1) / s * s - used))
        return out
    }

    static func unpack(_ bytes: Data) throws -> Data {
        let b = [UInt8](bytes.prefix(8))
        if b.count >= 8, Array(b[0 ..< 4]) == magic {
            let len = Int(bytes.uint32BE(at: 4))
            guard 8 + len <= bytes.count else { throw PackError.corrupt }
            return try Gzip.decompress(bytes.subdata(in: bytes.startIndex + 8 ..< bytes.startIndex + 8 + len))
        }
        if b.count > 2, b[0] == 0x1f, b[1] == 0x8b { return try Gzip.decompress(bytes) }
        return bytes
    }

    // Impressão do corpo empacotado (SHA-256 em base64), que vai no cabeçalho lacrado de quem envia.
    static func bodyHash(_ packed: Data) -> String { Data(SHA256.hash(data: packed)).b64 }
}

// gzip (RFC 1952) sobre o deflate puro do sistema.
enum Gzip {
    static func compress(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff])
        out.append(deflated)
        out.append(le32(CRC32.of(data)))
        out.append(le32(UInt32(truncatingIfNeeded: data.count)))
        return out
    }

    static func decompress(_ data: Data) throws -> Data {
        let b = [UInt8](data)
        guard b.count >= 18, b[0] == 0x1f, b[1] == 0x8b, b[2] == 8 else { throw PackError.corrupt }
        let flags = b[3]
        var at = 10
        if flags & 0x04 != 0 { guard at + 2 <= b.count else { throw PackError.corrupt }; at += 2 + Int(b[at]) | Int(b[at + 1]) << 8 }
        if flags & 0x08 != 0 { while at < b.count, b[at] != 0 { at += 1 }; at += 1 }
        if flags & 0x10 != 0 { while at < b.count, b[at] != 0 { at += 1 }; at += 1 }
        if flags & 0x02 != 0 { at += 2 }
        guard at < b.count - 8 else { throw PackError.corrupt }
        let body = Data(b[at ..< b.count - 8])
        let out = try (body as NSData).decompressed(using: .zlib) as Data
        let crc = UInt32(b[b.count - 8]) | UInt32(b[b.count - 7]) << 8 | UInt32(b[b.count - 6]) << 16 | UInt32(b[b.count - 5]) << 24
        guard crc == CRC32.of(out) else { throw PackError.corrupt }
        return out
    }

    private static func le32(_ v: UInt32) -> Data { Data([UInt8(v & 0xff), UInt8(v >> 8 & 0xff), UInt8(v >> 16 & 0xff), UInt8(v >> 24 & 0xff)]) }
}

enum CRC32 {
    private static let table: [UInt32] = (0 ..< 256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0 ..< 8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func of(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for byte in data { c = table[Int((c ^ UInt32(byte)) & 0xff)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }
}
