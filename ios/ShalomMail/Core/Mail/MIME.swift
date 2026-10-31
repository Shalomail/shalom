// Leitura de e-mail (MIME), no lugar do postal-mime do app web: cabeçalhos (com palavras codificadas da
// RFC 2047), partes (multipart), base64 e quoted-printable, charsets, anexos e imagens do texto (cid:).
// Também monta o e-mail que sai (build), com texto, HTML e anexos.
import Foundation

struct Attachment: Identifiable, Hashable {
    let id = UUID()
    let filename: String
    let mimeType: String
    let contentId: String?
    let inline: Bool
    let data: Data
}

struct ParsedEmail {
    var subject = ""
    var from: Person?
    var to: [Person] = []
    var cc: [Person] = []
    var replyTo: [Person] = []
    var date: String?
    var messageId: String?
    var inReplyTo: String?
    var references: String?
    var text: String?
    var html: String?
    var attachments: [Attachment] = []
    var headers: [(String, String)] = []

    // Anexos de verdade (sem as imagens que aparecem dentro do texto).
    var files: [Attachment] { attachments.filter { !($0.inline && $0.contentId != nil && (html?.contains("cid:\($0.contentId!)") ?? false)) } }
}

enum MIME {
    // MARK: leitura

    static func parse(_ data: Data) -> ParsedEmail {
        var out = ParsedEmail()
        let (headers, body) = splitHeaders(data)
        out.headers = headers
        out.subject = header(headers, "subject").map(decodeWords) ?? ""
        out.from = header(headers, "from").map(addresses)?.first
        out.to = header(headers, "to").map(addresses) ?? []
        out.cc = header(headers, "cc").map(addresses) ?? []
        out.replyTo = header(headers, "reply-to").map(addresses) ?? []
        out.date = header(headers, "date")
        out.messageId = header(headers, "message-id")?.trimmingCharacters(in: .whitespaces)
        out.inReplyTo = header(headers, "in-reply-to")?.trimmingCharacters(in: .whitespaces)
        out.references = header(headers, "references")?.trimmingCharacters(in: .whitespaces)
        walk(headers, body, into: &out, depth: 0)
        return out
    }

    private static func walk(_ headers: [(String, String)], _ body: Data, into out: inout ParsedEmail, depth: Int) {
        guard depth < 20 else { return }
        let (type, params) = contentType(headers)
        let disposition = header(headers, "content-disposition").map { parseParams($0) }
        if type.hasPrefix("multipart/"), let boundary = params["boundary"] {
            for part in splitMultipart(body, boundary: boundary) {
                let (h, b) = splitHeaders(part)
                walk(h, b, into: &out, depth: depth + 1)
            }
            return
        }
        let decoded = decodeTransfer(body, header(headers, "content-transfer-encoding"))
        let filename = disposition?.params["filename"] ?? params["name"]
        let isAttachment = disposition?.value == "attachment" || (filename != nil && !type.hasPrefix("text/"))
        if !isAttachment, type == "text/plain", out.text == nil {
            out.text = decodeCharset(decoded, params["charset"])
        } else if !isAttachment, type == "text/html", out.html == nil {
            out.html = decodeCharset(decoded, params["charset"])
        } else if type == "message/rfc822" {
            out.attachments.append(Attachment(filename: filename.map(decodeWords) ?? "message.eml", mimeType: type, contentId: nil, inline: false, data: decoded))
        } else if isAttachment || !type.hasPrefix("text/") || filename != nil {
            let cid = header(headers, "content-id")?.trimmingCharacters(in: CharacterSet(charactersIn: " <>"))
            out.attachments.append(Attachment(filename: filename.map(decodeWords) ?? "attachment", mimeType: type, contentId: cid, inline: disposition?.value == "inline" || (cid != nil && disposition?.value != "attachment"), data: decoded))
        }
    }

    static func splitHeaders(_ data: Data) -> ([(String, String)], Data) {
        let bytes = [UInt8](data)
        var end = bytes.count, bodyStart = bytes.count
        var i = 0
        while i < bytes.count - 1 {
            if bytes[i] == 0x0a && bytes[i + 1] == 0x0a { end = i; bodyStart = i + 2; break }
            if i < bytes.count - 3 && bytes[i] == 0x0d && bytes[i + 1] == 0x0a && bytes[i + 2] == 0x0d && bytes[i + 3] == 0x0a { end = i; bodyStart = i + 4; break }
            i += 1
        }
        let head = String(decoding: bytes[0 ..< end], as: UTF8.self)
        var headers: [(String, String)] = []
        for line in head.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            if let first = line.first, first == " " || first == "\t", !headers.isEmpty {
                headers[headers.count - 1].1 += " " + line.trimmingCharacters(in: .whitespaces)
            } else if let colon = line.firstIndex(of: ":") {
                headers.append((line[..<colon].lowercased().trimmingCharacters(in: .whitespaces), String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)))
            }
        }
        return (headers, bodyStart < bytes.count ? Data(bytes[bodyStart...]) : Data())
    }

    static func header(_ headers: [(String, String)], _ name: String) -> String? { headers.first { $0.0 == name }?.1 }

    private static func contentType(_ headers: [(String, String)]) -> (String, [String: String]) {
        guard let raw = header(headers, "content-type") else { return ("text/plain", [:]) }
        let p = parseParams(raw)
        return (p.value.isEmpty ? "text/plain" : p.value, p.params)
    }

    // "valor; nome=\"x\"; filename*=utf-8''%C3%A7" (com a RFC 2231 de partes numeradas).
    static func parseParams(_ raw: String) -> (value: String, params: [String: String]) {
        var parts: [String] = []
        var cur = "", quoted = false
        for ch in raw {
            if ch == "\"" { quoted.toggle(); cur.append(ch) } else if ch == ";" && !quoted { parts.append(cur); cur = "" } else { cur.append(ch) }
        }
        parts.append(cur)
        let value = parts.first?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        var params: [String: String] = [:]
        var continued: [String: [(Int, String, Bool)]] = [:]
        for p in parts.dropFirst() {
            guard let eq = p.firstIndex(of: "=") else { continue }
            var key = p[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            var v = p[p.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if v.hasPrefix("\""), v.hasSuffix("\""), v.count >= 2 { v = String(v.dropFirst().dropLast()) }
            let extended = key.hasSuffix("*")
            if extended { key.removeLast() }
            if let star = key.firstIndex(of: "*"), let n = Int(key[key.index(after: star)...]) {
                continued[String(key[..<star]), default: []].append((n, v, extended)); continue
            }
            params[key] = extended ? decode2231(v) : v
        }
        for (k, list) in continued {
            let sorted = list.sorted { $0.0 < $1.0 }
            let joined = sorted.map(\.1).joined()
            params[k] = sorted.first?.2 == true ? decode2231(joined) : joined
        }
        return (value, params)
    }

    private static func decode2231(_ v: String) -> String {
        let pieces = v.split(separator: "'", maxSplits: 2, omittingEmptySubsequences: false)
        let charset = pieces.count == 3 ? String(pieces[0]) : "utf-8"
        let text = pieces.count == 3 ? String(pieces[2]) : v
        var bytes: [UInt8] = []
        var i = text.startIndex
        while i < text.endIndex {
            if text[i] == "%", let j = text.index(i, offsetBy: 3, limitedBy: text.endIndex), let b = UInt8(text[text.index(after: i) ..< j], radix: 16) {
                bytes.append(b); i = j
            } else { bytes.append(contentsOf: Array(String(text[i]).utf8)); i = text.index(after: i) }
        }
        return decodeCharset(Data(bytes), charset)
    }

    private static func splitMultipart(_ body: Data, boundary: String) -> [Data] {
        let text = [UInt8](body)
        let marker = Array("--\(boundary)".utf8)
        var parts: [Data] = []
        var starts: [Int] = []
        var i = 0
        // Cada separador começa uma linha.
        while i <= text.count - marker.count {
            if (i == 0 || text[i - 1] == 0x0a) && Array(text[i ..< i + marker.count]) == marker {
                starts.append(i)
                i += marker.count
            } else { i += 1 }
        }
        for (n, s) in starts.enumerated() {
            var from = s + marker.count
            if from + 1 < text.count && text[from] == 0x2d && text[from + 1] == 0x2d { break }
            while from < text.count && text[from] != 0x0a { from += 1 }
            from += 1
            var to = n + 1 < starts.count ? starts[n + 1] : text.count
            if to > from && text[to - 1] == 0x0a { to -= 1 }
            if to > from && text[to - 1] == 0x0d { to -= 1 }
            if from < to { parts.append(Data(text[from ..< to])) }
        }
        return parts
    }

    private static func decodeTransfer(_ body: Data, _ encoding: String?) -> Data {
        switch encoding?.lowercased().trimmingCharacters(in: .whitespaces) {
        case "base64":
            let clean = String(decoding: body, as: UTF8.self).filter { !$0.isWhitespace }
            return Data(base64Encoded: clean + String(repeating: "=", count: (4 - clean.count % 4) % 4)) ?? Data()
        case "quoted-printable": return quotedPrintable(body)
        default: return body
        }
    }

    static func quotedPrintable(_ body: Data, underscoreSpace: Bool = false) -> Data {
        let b = [UInt8](body)
        var out: [UInt8] = []
        out.reserveCapacity(b.count)
        var i = 0
        func hex(_ c: UInt8) -> UInt8? {
            switch c { case 0x30 ... 0x39: return c - 0x30; case 0x41 ... 0x46: return c - 0x37; case 0x61 ... 0x66: return c - 0x57; default: return nil }
        }
        while i < b.count {
            let c = b[i]
            if c == 0x3d {
                if i + 1 < b.count && b[i + 1] == 0x0a { i += 2; continue }
                if i + 2 < b.count && b[i + 1] == 0x0d && b[i + 2] == 0x0a { i += 3; continue }
                if i + 2 < b.count, let h = hex(b[i + 1]), let l = hex(b[i + 2]) { out.append(h << 4 | l); i += 3; continue }
            }
            out.append(underscoreSpace && c == 0x5f ? 0x20 : c)
            i += 1
        }
        return Data(out)
    }

    static func decodeCharset(_ data: Data, _ charset: String?) -> String {
        let name = (charset ?? "utf-8").lowercased().trimmingCharacters(in: CharacterSet(charactersIn: " \""))
        if name == "utf-8" || name == "utf8" || name == "us-ascii" { return String(decoding: data, as: UTF8.self) }
        let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        if cf != kCFStringEncodingInvalidId, let s = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))) { return s }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
    }

    // =?utf-8?B?...?= e =?iso-8859-1?Q?...?=; palavras codificadas lado a lado se juntam sem o espaço.
    static func decodeWords(_ s: String) -> String {
        guard s.contains("=?") else { return s }
        let pattern = try! NSRegularExpression(pattern: "=\\?([^?]+)\\?([bBqQ])\\?([^?]*)\\?=")
        let ns = s as NSString
        var out = ""
        var last = 0
        var prevWasWord = false
        for m in pattern.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            let gap = ns.substring(with: NSRange(location: last, length: m.range.location - last))
            if !(prevWasWord && gap.trimmingCharacters(in: .whitespaces).isEmpty) { out += gap }
            let charset = ns.substring(with: m.range(at: 1)).components(separatedBy: "*").first ?? "utf-8"
            let enc = ns.substring(with: m.range(at: 2)).lowercased()
            let text = ns.substring(with: m.range(at: 3))
            let bytes = enc == "b" ? (Data(base64Encoded: text + String(repeating: "=", count: (4 - text.count % 4) % 4)) ?? Data()) : quotedPrintable(Data(text.utf8), underscoreSpace: true)
            out += decodeCharset(bytes, charset)
            last = m.range.location + m.range.length
            prevWasWord = true
        }
        out += ns.substring(from: last)
        return out
    }

    // "Ana <ana@x.com>, \"Silva, Bia\" <bia@y.com>, carla@z.com"
    static func addresses(_ raw: String) -> [Person] {
        var list: [String] = []
        var cur = "", quoted = false, angle = false
        for ch in raw {
            if ch == "\"" && !angle { quoted.toggle() } else if ch == "<" && !quoted { angle = true } else if ch == ">" && !quoted { angle = false }
            if ch == "," && !quoted && !angle { list.append(cur); cur = "" } else { cur.append(ch) }
        }
        list.append(cur)
        return list.compactMap { item in
            var s = item.trimmingCharacters(in: .whitespaces)
            // Grupo ("Equipe: a@b, c@d;"), já partido pela vírgula: tira o rótulo do primeiro.
            if let colon = s.firstIndex(of: ":"), !s[..<colon].contains(where: { "@<\"".contains($0) }) { s = String(s[s.index(after: colon)...]) }
            s = s.trimmingCharacters(in: CharacterSet(charactersIn: " ;"))
            if let lt = s.lastIndex(of: "<"), let gt = s.lastIndex(of: ">"), lt < gt {
                let addr = s[s.index(after: lt) ..< gt].trimmingCharacters(in: .whitespaces).lowercased()
                let name = decodeWords(s[..<lt].trimmingCharacters(in: CharacterSet(charactersIn: " \"")))
                return addr.contains("@") ? Person(name: name, address: addr) : nil
            }
            return s.contains("@") ? Person(name: "", address: s.lowercased()) : nil
        }
    }
}
