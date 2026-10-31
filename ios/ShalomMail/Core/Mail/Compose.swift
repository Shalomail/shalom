// Escrever e enviar, igual ao web/src/lib/send.ts e mime.ts. Para cada conta Shalom o e-mail sai lacrado aqui,
// com a chave dela e o remetente lacrado (certificado do servidor), e é entregue sem cookie com um ingresso
// anônimo. Para quem está fora, o texto vai aberto até o servidor de envio, como todo e-mail comum; a cópia de
// Enviados vai lacrada com a chave calculada aqui.
import BigInt
import Foundation
import UIKit

struct OutgoingAttachment: Identifiable, Hashable {
    let id = UUID()
    var filename: String
    var type: String
    var content: Data
    var cid: String?
}

struct Outgoing {
    var to: [Person] = []
    var cc: [Person] = []
    var bcc: [Person] = []
    var subject = ""
    var text = ""
    var quoted: (header: String, html: String)?
    var inReplyTo: String?
    var references: String?
    var attachments: [OutgoingAttachment] = []
}

enum ComposeError: LocalizedError {
    case keyChanged(address: String, before: String, after: String, newKey: String)
    case noSuchUser(String)
    case badTokens
    var errorDescription: String? {
        switch self {
        case .keyChanged(let a, _, _, _): return t("err.key_changed", ["address": a])
        case .noSuchUser(let a): return t("err.no_such_user", ["address": a])
        case .badTokens: return t("err.bad_tokens")
        }
    }
}

enum MIMEBuilder {
    private static func ascii(_ s: String) -> Bool { s.unicodeScalars.allSatisfy { $0.value >= 0x20 && $0.value <= 0x7e } }

    // Palavra codificada (RFC 2047), em pedaços de até 45 bytes sem cortar caractere no meio.
    static func encodeWord(_ s: String) -> String {
        if ascii(s) { return s }
        var words: [String] = []
        var chunk = ""
        for ch in s {
            if (chunk + String(ch)).utf8.count > 45 { words.append(chunk); chunk = "" }
            chunk.append(ch)
        }
        if !chunk.isEmpty { words.append(chunk) }
        return words.map { "=?UTF-8?B?\(Data($0.utf8).base64EncodedString())?=" }.joined(separator: "\r\n ")
    }

    static func person(_ p: Person) -> String {
        guard !p.name.isEmpty else { return p.address }
        let name = ascii(p.name) ? "\"\(p.name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\"" : encodeWord(p.name)
        return "\(name) <\(p.address)>"
    }

    private static func clean(_ s: String) -> String { s.replacingOccurrences(of: "[\r\n]+", with: " ", options: .regularExpression) }
    private static func wrap76(_ b64: String) -> String {
        stride(from: 0, to: b64.count, by: 76).map { i -> String in
            let start = b64.index(b64.startIndex, offsetBy: i); let end = b64.index(start, offsetBy: min(76, b64.count - i)); return String(b64[start ..< end]) + "\r\n"
        }.joined()
    }

    private static func body(_ type: String, _ content: String) -> String {
        "Content-Type: \(type); charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n\(wrap76(Data(content.utf8).base64EncodedString()))"
    }

    private static func binary(_ a: OutgoingAttachment) -> String {
        let name = encodeWord(clean(a.filename)).replacingOccurrences(of: "\"", with: "")
        var head = ["Content-Type: \(a.type); name=\"\(name)\"", "Content-Disposition: \(a.cid != nil ? "inline" : "attachment"); filename=\"\(name)\"", "Content-Transfer-Encoding: base64"]
        if let cid = a.cid { head.append("Content-ID: <\(cid)>") }
        return head.joined(separator: "\r\n") + "\r\n\r\n" + wrap76(a.content.base64EncodedString())
    }

    // mixed (anexos) > related (imagens do texto) > alternative (texto puro e HTML).
    static func build(from: Person, _ o: Outgoing, text: String, html: String, messageId: String, date: Date, includeBcc: Bool) -> Data {
        let alt = "alt-\(UUID().uuidString)"
        var type = "multipart/alternative; boundary=\"\(alt)\""
        var content = "--\(alt)\r\n\(body("text/plain", text))--\(alt)\r\n\(body("text/html", html))--\(alt)--\r\n"
        let inline = o.attachments.filter { $0.cid != nil }, files = o.attachments.filter { $0.cid == nil }
        if !inline.isEmpty {
            let rel = "rel-\(UUID().uuidString)"
            content = "--\(rel)\r\nContent-Type: \(type)\r\n\r\n\(content)" + inline.map { "--\(rel)\r\n\(binary($0))" }.joined() + "--\(rel)--\r\n"
            type = "multipart/related; boundary=\"\(rel)\""
        }
        if !files.isEmpty {
            let mix = "mix-\(UUID().uuidString)"
            content = "--\(mix)\r\nContent-Type: \(type)\r\n\r\n\(content)" + files.map { "--\(mix)\r\n\(binary($0))" }.joined() + "--\(mix)--\r\n"
            type = "multipart/mixed; boundary=\"\(mix)\""
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss '+0000'"
        var h = ["From: \(person(from))"]
        if !o.to.isEmpty { h.append("To: \(o.to.map(person).joined(separator: ", "))") }
        if !o.cc.isEmpty { h.append("Cc: \(o.cc.map(person).joined(separator: ", "))") }
        if includeBcc && !o.bcc.isEmpty { h.append("Bcc: \(o.bcc.map(person).joined(separator: ", "))") }
        h.append("Subject: \(encodeWord(clean(o.subject)))")
        h.append("Date: \(f.string(from: date))")
        h.append("Message-ID: \(messageId)")
        if let r = o.inReplyTo { h.append("In-Reply-To: \(clean(r))") }
        if let r = o.references { h.append("References: \(clean(r))") }
        h.append("MIME-Version: 1.0")
        return Data((h.joined(separator: "\r\n") + "\r\nContent-Type: \(type)\r\n\r\n\(content)").utf8)
    }

    static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    // Texto digitado vira HTML simples: parágrafos, quebras e links clicáveis, com a citação embaixo.
    static func textToHtml(_ text: String, quoted: (header: String, html: String)?) -> String {
        let linked = esc(text).replacingOccurrences(of: "https?://[^\\s<]+", with: "<a href=\"$0\">$0</a>", options: .regularExpression).replacingOccurrences(of: "\n", with: "<br>")
        let quote = quoted.map { "<br><div>\(esc($0.header))</div><blockquote style=\"margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex\">\($0.html)</blockquote>" } ?? ""
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5\">\(linked)\(quote)</div>"
    }
}

actor Outbox {
    static let shared = Outbox()
    private var cert: (signed: SignedCert, until: Double)?
    private var tickets: [(token: Data, sig: String)] = []
    private var keyCache: [String: String?] = [:]

    static func isShalom(_ address: String) -> Bool { address.lowercased().hasSuffix("@\(AppModel.domain)") }

    func forget() { cert = nil; tickets = []; keyCache = [:] }

    // Chave pública de outra conta Shalom, perguntada sem cookie (o servidor não sabe quem procurou quem).
    func publicKey(of address: String) async throws -> String? {
        let a = address.lowercased()
        guard Self.isShalom(a) else { return nil }
        if let cached = keyCache[a] { return cached }
        let r = try await API.shared.call("/keys", ["address": a], anonymous: true)
        let key = r["publicKey"] as? String
        keyCache[a] = .some(key)
        return key
    }

    // Certificado de remetente (vale 7 dias; renova com um dia de folga).
    private func myCert() async throws -> SignedCert {
        if let cert, cert.until > Date().timeIntervalSince1970 * 1000 + 86_400_000 { return cert.signed }
        let r = try await API.shared.call("/cert", [:])
        guard let c = r["cert"] as? [String: String], let cc = c["c"], let s = c["s"], let raw = Data(b64: cc),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any], let until = obj["e"] as? Double else {
            throw APIError(status: 0, code: "internal", message: t("err.internal"))
        }
        let signed = SignedCert(c: cc, s: s)
        cert = (signed, until)
        return signed
    }

    // Ingressos de entrega: pedidos embaralhados com a conta logada, usados depois sem identificação.
    private func takeTicket() async throws -> (token: Data, sig: String) {
        if tickets.isEmpty {
            let pub = try await ServerKeys.shared.get().token
            let batch = (0 ..< 5).map { _ -> (Data, BlindPair) in let tok = Blind.newToken(); let b = Blind.blind(pub, token: tok); return (tok, BlindPair(blinded: b.blinded, r: b.r)) }
            let r = try await API.shared.call("/tokens", ["blinded": batch.map { Blind.bytes($0.1.blinded, length: pub.length).b64url }])
            let signed = r["signed"] as? [String] ?? []
            for (i, item) in batch.enumerated() where i < signed.count {
                guard let sb = Data(b64url: signed[i]), let sig = try? Blind.unblind(pub, signedBlinded: .init(sb), r: item.1.r), Blind.verify(pub, token: item.0, signature: sig) else { continue }
                tickets.append((item.0, Blind.bytes(sig, length: pub.length).b64url))
            }
            if tickets.isEmpty { throw ComposeError.badTokens }
        }
        return tickets.removeFirst()
    }

    private func sealedCopy(_ mime: Data, to pub: Data, session: Session, cert: SignedCert, e2e: Bool = true) throws -> [String: String] {
        let packed = try Pack.pack(mime)
        var head = Head.of(MIME.parse(mime), sentAt: Date(), e2e: e2e)
        head.b = Pack.bodyHash(packed)
        return [
            "head": try Sender.seal(to: pub, senderSecret: session.secretKey, cert: cert, try JSONEncoder().encode(head), .head).b64,
            "raw": try Sender.seal(to: pub, senderSecret: session.secretKey, cert: cert, packed, .raw).b64,
        ]
    }

    @discardableResult
    func send(_ out: Outgoing, session: Session) async throws -> [String: Any] {
        let all = out.to + out.cc + out.bcc
        let html = MIMEBuilder.textToHtml(out.text, quoted: out.quoted)
        let text = out.quoted.map { "\(out.text)\n\n\($0.header)\n" } ?? out.text
        let me = Person(name: session.user.name, address: session.user.address)
        let messageId = "<\(UUID().uuidString.lowercased())@\(AppModel.domain)>"
        let date = Date()
        let forThem = MIMEBuilder.build(from: me, out, text: text, html: html, messageId: messageId, date: date, includeBcc: false)
        let forMe = MIMEBuilder.build(from: me, out, text: text, html: html, messageId: messageId, date: date, includeBcc: true)
        let cert = try await myCert()

        var sealedFor: [(String, [String: String])] = []
        for address in Array(Set(all.map { $0.address.lowercased() }.filter(Self.isShalom))).sorted() {
            guard let pub = try await publicKey(of: address), let pubData = Data(b64: pub) else { throw ComposeError.noSuchUser(address) }
            let pinned = await Pins.shared.check(session.user.id, address, pub)
            guard pinned == pub else {
                throw ComposeError.keyChanged(address: address, before: Fingerprint.of(address: address, publicKey: Data(b64: pinned) ?? Data()), after: Fingerprint.of(address: address, publicKey: pubData), newKey: pub)
            }
            sealedFor.append((address, try sealedCopy(forThem, to: pubData, session: session, cert: cert)))
        }

        // Primeiro o que falha mais (fora do Shalom e a cópia de Enviados): se falhar, ninguém recebeu nada.
        let outside = { (l: [Person]) in l.filter { !Self.isShalom($0.address) }.map { ["name": $0.name, "address": $0.address] } }
        let hasExternal = all.contains { !Self.isShalom($0.address) }
        var body: [String: Any] = ["sentCopy": try sealedCopy(forMe, to: try Seal.publicKey(of: session.secretKey), session: session, cert: cert, e2e: !hasExternal)]
        if hasExternal {
            body["to"] = outside(out.to); body["cc"] = outside(out.cc); body["bcc"] = outside(out.bcc)
            body["subject"] = out.subject; body["text"] = text; body["html"] = html; body["messageId"] = messageId
            if let r = out.inReplyTo { body["inReplyTo"] = r }
            if let r = out.references { body["references"] = r }
            body["attachments"] = out.attachments.map { a -> [String: Any] in
                var d: [String: Any] = ["filename": a.filename, "type": a.type, "content": a.content.b64]
                if let cid = a.cid { d["cid"] = cid }
                return d
            }
        }
        let sent = try await API.shared.call("/send", body)

        // Cada conta Shalom recebe por uma entrega sem cookie, com um ingresso que não identifica quem enviou.
        for (address, sealed) in sealedFor {
            let ticket = try await takeTicket()
            try await API.shared.call("/deliver", ["to": address, "head": sealed["head"]!, "raw": sealed["raw"]!, "token": ticket.token.b64, "sig": ticket.sig], anonymous: true)
        }
        return sent
    }

    // Rascunho: a mensagem inteira lacrada com a própria chave, no lugar da versão anterior (replace).
    func saveDraft(_ out: Outgoing, replace: String?, session: Session) async throws -> String {
        let me = Person(name: session.user.name, address: session.user.address)
        let mime = MIMEBuilder.build(from: me, out, text: out.text, html: MIMEBuilder.textToHtml(out.text, quoted: nil), messageId: "<\(UUID().uuidString.lowercased())@\(AppModel.domain)>", date: Date(), includeBcc: true)
        var body: [String: Any] = try sealedCopy(mime, to: try Seal.publicKey(of: session.secretKey), session: session, cert: try await myCert())
        if let replace { body["replace"] = replace }
        return (try await API.shared.call("/drafts", body))["id"] as? String ?? ""
    }

    func deleteDraft(_ id: String) async { _ = try? await API.shared.call("/drafts/delete", ["ids": [id]]) }
}

private struct BlindPair { let blinded: BigUInt; let r: BigUInt }

// Foto refeita no iPhone antes de trancar, como o web (lib/attach.ts): no máximo 2560 px no lado maior, em
// JPEG (todo leitor abre) e sem os dados escondidos do arquivo (local, câmera). Se sair maior, fica a original.
enum ImagePrep {
    static let maxSide: CGFloat = 2560
    static let maxTotal = Int(3.5 * 1024 * 1024)

    static func prepare(_ data: Data, filename: String, type: String) -> OutgoingAttachment {
        guard type.hasPrefix("image/"), type != "image/gif", type != "image/svg+xml", let image = UIImage(data: data) else {
            return OutgoingAttachment(filename: filename, type: type, content: data)
        }
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: max(1, (image.size.width * scale).rounded()), height: max(1, (image.size.height * scale).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let redone = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = redone.jpegData(compressionQuality: type == "image/png" ? 0.9 : 0.82), jpeg.count < data.count || type == "image/heic" || type == "image/heif" else {
            return OutgoingAttachment(filename: filename, type: type, content: data)
        }
        let base = (filename as NSString).deletingPathExtension
        return OutgoingAttachment(filename: (base.isEmpty ? "foto" : base) + ".jpg", type: "image/jpeg", content: jpeg)
    }
}
