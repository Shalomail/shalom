// Lista e leitura, igual ao web/src/lib/mailbox.ts: tudo chega lacrado e abre aqui com a chave do iPhone.
// Mensagem com remetente lacrado: certificado e lacre autenticado conferidos aqui, e é daqui (não do
// servidor) que vem quem enviou. Só vale como conferido se a chave do certificado for a fixada (Pins).
import Foundation

struct Person: Codable, Hashable { var name: String; var address: String }

struct MessageHead: Codable {
    var from: Person?
    var to: [Person]
    var subject: String
    var date: String
    var snippet: String
    var attachments: Int
    var t: String?
    var auth: String
    var e2e: Bool
    var b: String?

    init(from: Person?, to: [Person], subject: String, date: String, snippet: String, attachments: Int, t: String? = nil, auth: String, e2e: Bool, b: String? = nil) {
        self.from = from; self.to = to; self.subject = subject; self.date = date; self.snippet = snippet
        self.attachments = attachments; self.t = t; self.auth = auth; self.e2e = e2e; self.b = b
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeIfPresent(Person.self, forKey: .from)
        to = (try? c.decodeIfPresent([Person].self, forKey: .to)) ?? []
        subject = (try? c.decodeIfPresent(String.self, forKey: .subject)) ?? ""
        date = (try? c.decodeIfPresent(String.self, forKey: .date)) ?? ""
        snippet = (try? c.decodeIfPresent(String.self, forKey: .snippet)) ?? ""
        attachments = (try? c.decodeIfPresent(Int.self, forKey: .attachments)) ?? 0
        t = try? c.decodeIfPresent(String.self, forKey: .t)
        auth = (try? c.decodeIfPresent(String.self, forKey: .auth)) ?? "unknown"
        e2e = (try? c.decodeIfPresent(Bool.self, forKey: .e2e)) ?? false
        b = try? c.decodeIfPresent(String.self, forKey: .b)
    }
}

enum Folder: String, CaseIterable, Identifiable {
    case inbox, starred, sent, drafts, archive, spam, trash
    var id: String { rawValue }
    var title: String { t("mailbox.folders.\(rawValue)") }
    var icon: String {
        switch self {
        case .inbox: return "tray"; case .starred: return "star"; case .sent: return "paperplane"; case .drafts: return "pencil"
        case .archive: return "archivebox"; case .spam: return "xmark.shield"; case .trash: return "trash"
        }
    }
}

struct Row: Decodable {
    let id: String
    let folder: String
    let seen: Int
    let starred: Int
    let pinned: Int
    let received_at: Double
    let size: Int
    let sender: String?
    let head: String
}

struct Item: Identifiable, Hashable {
    let id: String
    var folder: String
    var seen: Bool
    var starred: Bool
    var pinned: Bool
    let receivedAt: Double
    let size: Int
    // Remetente conferido no aparelho (lacrado de ponta a ponta), ou nil.
    let sender: String?
    let h: MessageHead
    // Fechado de ponta a ponta: veio de outra conta Shalom, ou é a sua cópia de algo que foi só para contas Shalom.
    let sealedEnd: Bool
    // A sua própria cópia (Enviados), lacrada por você.
    let own: Bool
    let keyChanged: Bool
    let senderKey: String?
    // O remetente escrito no e-mail não confere com quem enviou de fato.
    let spoofed: Bool

    static func == (a: Item, b: Item) -> Bool { a.id == b.id && a.seen == b.seen && a.starred == b.starred && a.folder == b.folder && a.pinned == b.pinned }
    func hash(into h: inout Hasher) { h.combine(id) }
    var date: Date { Date(timeIntervalSince1970: receivedAt / 1000) }
}

struct Thread: Identifiable {
    let key: String
    var items: [Item]
    var inFolder: [Item]
    var latest: Item { items.last! }
    var unread: Bool { inFolder.contains { !$0.seen } }
    var starred: Bool { inFolder.contains { $0.starred } }
    var pinned: Bool { inFolder.contains { $0.pinned } }
    var id: String { key }
}

typealias Counts = [String: Int]

final class Mailbox {
    static let shared = Mailbox()

    private struct Opened { let h: MessageHead; let sender: String?; let keyChanged: Bool; let key: String? }
    private var heads: [String: Opened] = [:]
    // Linhas já abertas nesta sessão: só para as sugestões de contato, que ficam neste aparelho.
    private var seen: [String: Item] = [:]
    private var bodies: [String: ParsedEmail] = [:]
    private let lock = NSLock()

    func forget() { lock.lock(); heads = [:]; bodies = [:]; seen = [:]; lock.unlock() }

    private func headFor(_ row: Row, _ session: Session) async -> Opened {
        if let cached = lock.withLock({ heads[row.id] }) { return cached }
        var out: Opened
        if let blob = Data(b64: row.head) {
            do {
                if Sender.isSealedSender(blob) {
                    let cert = try await ServerKeys.shared.get().cert
                    let r = try Sender.open(session.secretKey, blob, .head, serverPublic: cert, receivedAt: row.received_at)
                    let h = try JSONDecoder().decode(MessageHead.self, from: r.payload)
                    let pinned = await Pins.shared.check(session.user.id, r.address, r.publicKey)
                    out = pinned == r.publicKey ? Opened(h: h, sender: r.address, keyChanged: false, key: r.publicKey) : Opened(h: h, sender: nil, keyChanged: true, key: nil)
                } else {
                    out = Opened(h: try Seal.openJSON(session.secretKey, blob, as: MessageHead.self), sender: nil, keyChanged: false, key: nil)
                }
            } catch {
                out = Self.unreadable(row)
            }
        } else { out = Self.unreadable(row) }
        lock.withLock { heads[row.id] = out }
        return out
    }

    private static func unreadable(_ row: Row) -> Opened {
        Opened(h: MessageHead(from: nil, to: [], subject: t("mailbox.unreadable"), date: ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: row.received_at / 1000)), snippet: "", attachments: 0, auth: "fail", e2e: false), sender: nil, keyChanged: false, key: nil)
    }

    func list(_ folder: Folder, before: Double? = nil, session: Session) async throws -> (items: [Item], more: Bool, counts: Counts) {
        var q = "folder=\(folder.rawValue)&limit=50"
        if let before { q += "&before=\(Int(before))" }
        struct Res: Decodable { let messages: [Row]; let more: Bool; let counts: Counts }
        let res = try await API.shared.decode(Res.self, "/messages?\(q)")
        var items: [Item] = []
        for r in res.messages {
            let o = await headFor(r, session)
            // O selo de ponta a ponta vem do remetente conferido no aparelho, nunca do que o remetente escreveu.
            // E-mail de fora dizendo ser @shalomail.com é falso por definição.
            let verified = o.sender != nil
            // A sua cópia de Enviados também chega lacrada por você, mas só é de ponta a ponta se foi apenas para
            // contas Shalom (e2e, gravado no envio). Cópias antigas marcavam e2e sempre: nelas vale a lista Para.
            let own = verified && o.sender == session.user.address.lowercased()
            let sealedEnd = verified && (!own || (o.h.e2e && o.h.to.allSatisfy { Outbox.isShalom($0.address) }))
            let from = o.h.from?.address.lowercased() ?? ""
            let spoofed = verified ? from != o.sender : (o.h.auth == "fail" || from.hasSuffix("@\(AppModel.domain)"))
            var h = o.h
            if verified { h.from = Person(name: o.h.from?.name ?? "", address: o.sender!) }
            items.append(Item(id: r.id, folder: r.folder, seen: r.seen != 0, starred: r.starred != 0, pinned: r.pinned != 0, receivedAt: r.received_at, size: r.size,
                              sender: o.sender, h: h, sealedEnd: sealedEnd, own: own, keyChanged: o.keyChanged, senderKey: o.key, spoofed: spoofed || o.keyChanged))
        }
        lock.withLock { for i in items { seen[i.id] = i } }
        return (items, res.more, res.counts)
    }

    // Sugestões do Para, Cc e Cco, como web/src/lib/contacts.ts: quem escreveu para você e para quem você
    // escreveu, pesado pela idade. Spam, remetente falso e endereço que não recebe resposta ficam de fora.
    func contacts(me: String) -> [Person] {
        let mine = me.lowercased()
        let now = Date().timeIntervalSince1970 * 1000
        let noReply = try! NSRegularExpression(pattern: "^(no-?reply|nao-?responda|naoresponda|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?)([._+-]|@)", options: .caseInsensitive)
        var score: [String: (Person, Double)] = [:]
        func add(_ p: Person?, _ at: Double, _ weight: Double) {
            guard let p, p.address.contains("@"), p.address.lowercased() != mine,
                  noReply.firstMatch(in: p.address, range: NSRange(p.address.startIndex..., in: p.address)) == nil else { return }
            let w = weight / (1 + max(0, now - at) / (30 * 86_400_000))
            let a = p.address.lowercased()
            let name = score[a]?.0.name.isEmpty == false ? score[a]!.0.name : p.name
            score[a] = (Person(name: name, address: a), (score[a]?.1 ?? 0) + w)
        }
        for i in lock.withLock({ Array(seen.values) }) where i.folder != "spam" && !i.spoofed {
            if i.folder == "sent" { i.h.to.forEach { add($0, i.receivedAt, 3) } } else { add(i.h.from, i.receivedAt, 1) }
        }
        return score.values.sorted { $0.1 > $1.1 }.map(\.0)
    }

    func counts() async throws -> Counts { try await API.shared.decode(Counts.self, "/messages/counts") }

    enum ReadError: LocalizedError {
        case bodySender, senderKey, notSealed
        var errorDescription: String? {
            switch self { case .bodySender: return t("reader.bodySender"); case .senderKey: return t("reader.senderKey"); case .notSealed: return t("reader.notSealed") }
        }
    }

    func read(_ item: Item, session: Session) async throws -> ParsedEmail {
        if let cached = lock.withLock({ bodies[item.id] }) { return cached }
        let blob = try await API.shared.bytes("/messages/\(item.id)/raw")
        let raw: Data
        if Sender.isSealedSender(blob) {
            let cert = try await ServerKeys.shared.get().cert
            let opened = try Sender.open(session.secretKey, blob, .raw, serverPublic: cert, receivedAt: item.receivedAt)
            if let s = item.sender, opened.address != s { throw ReadError.bodySender }
            if item.sender != nil, await Pins.shared.check(session.user.id, opened.address, opened.publicKey) != opened.publicKey { throw ReadError.senderKey }
            // Mensagem nova traz no cabeçalho a impressão do corpo: corpo de outra mensagem não passa.
            if let b = item.h.b, Pack.bodyHash(opened.payload) != b { throw ReadError.bodySender }
            raw = opened.payload
        } else {
            // Cabeçalho com remetente conferido exige corpo lacrado pelo mesmo remetente.
            if item.sender != nil { throw ReadError.notSealed }
            raw = try Seal.open(session.secretKey, blob, .raw)
        }
        let email = MIME.parse(try Pack.unpack(raw))
        lock.withLock { bodies[item.id] = email }
        return email
    }

    @discardableResult
    func update(_ ids: [String], seen: Bool? = nil, starred: Bool? = nil, pinned: Bool? = nil, folder: String? = nil) async throws -> Counts {
        var counts: Counts = [:]
        for part in stride(from: 0, to: ids.count, by: 90).map({ Array(ids[$0 ..< min($0 + 90, ids.count)]) }) {
            var body: [String: Any] = ["ids": part]
            if let seen { body["seen"] = seen }
            if let starred { body["starred"] = starred }
            if let pinned { body["pinned"] = pinned }
            if let folder { body["folder"] = folder }
            counts = (try await API.shared.call("/messages/update", body))["counts"] as? Counts ?? counts
        }
        return counts
    }

    func deleteForever(_ ids: [String]) async throws {
        for part in stride(from: 0, to: ids.count, by: 90).map({ Array(ids[$0 ..< min($0 + 90, ids.count)]) }) {
            try await API.shared.call("/messages/delete", ["ids": part])
        }
    }

    // Conversas, igual ao threadsOf do web: pela marca lacrada no cabeçalho (h.t), juntando as mensagens da
    // outra pasta carregada; resposta sem referência junta pela pessoa e pelo assunto sem o "Re:".
    static func threads(_ folderItems: [Item], extra: [Item]) -> [Thread] {
        func key(_ i: Item) -> String { i.h.t ?? "id:\(i.id)" }
        var order: [String] = []
        var map: [String: Thread] = [:]
        for i in folderItems {
            let k = key(i)
            if map[k] != nil { map[k]!.items.append(i); map[k]!.inFolder.append(i) } else { map[k] = Thread(key: k, items: [i], inFolder: [i]); order.append(k) }
        }
        for i in extra {
            let k = key(i)
            if map[k] != nil, !map[k]!.items.contains(where: { $0.id == i.id }) { map[k]!.items.append(i) }
        }
        func other(_ i: Item) -> String { ((i.folder == "sent" ? i.h.to.first?.address : i.h.from?.address) ?? "").lowercased() }
        func subjectKey(_ i: Item) -> String { "\(cleanSubject(i.h.subject).lowercased())|\(other(i))" }
        func isReply(_ s: String) -> Bool { cleanSubject(s) != s.trimmingCharacters(in: .whitespaces) }
        func first(_ th: Thread) -> Item { th.items.min { $0.receivedAt < $1.receivedAt }! }
        var roots: [String: String] = [:]
        for k in order { if let th = map[k], !isReply(first(th).h.subject), !cleanSubject(first(th).h.subject).isEmpty { roots[subjectKey(first(th))] = k } }
        for k in order {
            guard let th = map[k], isReply(first(th).h.subject), let home = roots[subjectKey(first(th))], home != k, map[home] != nil else { continue }
            for i in th.items where !map[home]!.items.contains(where: { $0.id == i.id }) { map[home]!.items.append(i) }
            for i in th.inFolder where !map[home]!.inFolder.contains(where: { $0.id == i.id }) { map[home]!.inFolder.append(i) }
            map[k] = nil
        }
        var out = order.compactMap { map[$0] }
        for i in out.indices { out[i].items.sort { $0.receivedAt < $1.receivedAt } }
        out.sort { ($0.pinned ? 1 : 0, $0.latest.receivedAt) > ($1.pinned ? 1 : 0, $1.latest.receivedAt) }
        return out
    }

    static func cleanSubject(_ s: String) -> String {
        s.replacingOccurrences(of: "^\\s*((re|res|enc|fw|fwd|rv)\\s*:\\s*)+", with: "", options: [.regularExpression, .caseInsensitive]).trimmingCharacters(in: .whitespaces)
    }
}
