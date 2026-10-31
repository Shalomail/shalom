// Cabeçalho lacrado da mensagem (o que a lista mostra sem baixar o corpo), igual ao shared/head.ts. A marca
// da conversa (t) usa o mesmo hash curto do site, para as respostas se juntarem nos dois lados.
import Foundation

enum Head {
    // Hash curto (53 bits), só para agrupar; não é segurança. Mesma conta do site, em 32 bits com estouro.
    static func shortHash(_ s: String) -> String {
        let units = Array(s.utf16)
        var h1 = UInt32(0xdeadbeef) ^ UInt32(truncatingIfNeeded: units.count)
        var h2 = UInt32(0x41c6ce57) ^ UInt32(truncatingIfNeeded: units.count)
        for ch in units {
            h1 = (h1 ^ UInt32(ch)) &* 2_654_435_761
            h2 = (h2 ^ UInt32(ch)) &* 1_597_334_677
        }
        h1 = ((h1 ^ (h1 >> 16)) &* 2_246_822_507) ^ ((h2 ^ (h2 >> 13)) &* 3_266_489_909)
        h2 = ((h2 ^ (h2 >> 16)) &* 2_246_822_507) ^ ((h1 ^ (h1 >> 13)) &* 3_266_489_909)
        return String(UInt64(2_097_151 & h2) * 4_294_967_296 + UInt64(h1), radix: 36)
    }

    private static func firstId(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "" }
        if let r = s.range(of: "<[^<>\\s]+>", options: .regularExpression) { return String(s[r]) }
        return s.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
    }

    static func threadKey(references: String?, inReplyTo: String?, messageId: String?) -> String {
        let root = [firstId(references), firstId(inReplyTo), firstId(messageId)].first { !$0.isEmpty } ?? ""
        return root.isEmpty ? "" : shortHash(root.lowercased())
    }

    static func snippet(_ text: String?, _ html: String?) -> String {
        var s = text ?? ""
        if s.isEmpty, let html {
            s = html.replacingOccurrences(of: "<(style|script|head)[\\s\\S]*?</\\1>", with: " ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
                .replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<")
                .replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#39;", with: "'")
        }
        let collapsed = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        return String(collapsed.prefix(110))
    }

    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    // Só para o que sai deste iPhone: auth "pass". e2e: a cópia de cada conta Shalom sempre é; a de Enviados
    // só quando ninguém de fora recebeu.
    static func of(_ email: ParsedEmail, sentAt: Date, e2e: Bool = true) -> MessageHead {
        let key = threadKey(references: email.references, inReplyTo: email.inReplyTo, messageId: email.messageId)
        return MessageHead(from: email.from, to: Array(email.to.prefix(5)), subject: String(email.subject.trimmingCharacters(in: .whitespaces).prefix(200)),
                           date: iso(sentAt), snippet: snippet(email.text, email.html),
                           attachments: email.attachments.filter { !$0.inline || $0.contentId == nil }.count,
                           t: key.isEmpty ? nil : key, auth: "pass", e2e: e2e)
    }
}
