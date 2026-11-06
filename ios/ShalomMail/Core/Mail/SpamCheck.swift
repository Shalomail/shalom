// Filtro de spam no aparelho (shared/spam.ts, empacotado em Resources/spam.js por scripts/ios-spam.mjs). O
// servidor só separa na chegada o que não pede ler o texto; o resto é conferido aqui, com o texto aberto só neste
// iPhone. Cada e-mail de fora que chega na Entrada é conferido uma vez, por qualquer aparelho da conta: a marca de
// conferido fica no servidor e não diz nada do conteúdo. Quem a pessoa tirou do Spam com "Não é spam" (e veio com o
// domínio confirmando o remetente) não é mais conferido aqui; a lista guarda só uma impressão de cada endereço,
// feita com a chave da conta.
import CryptoKit
import Foundation
import JavaScriptCore

actor SpamCheck {
    static let shared = SpamCheck()

    // Corpo acima disso não é baixado só para conferir: vale o assunto e a prévia.
    private static let bodyMax = 4 * 1024 * 1024
    private var context: JSContext?
    private var running: Set<String> = []

    private func rule() -> JSValue? {
        if context == nil, let url = Bundle.main.url(forResource: "spam", withExtension: "js"), let js = try? String(contentsOf: url, encoding: .utf8) {
            let c = JSContext()
            c?.evaluateScript(js)
            context = c
        }
        return context?.objectForKeyedSubscript("shalomSpam")
    }

    // nil: sem a regra (arquivo faltando ou erro no JavaScript).
    private func isSpam(subject: String, text: String?, html: String?, from: String) -> Bool? {
        let input: [String: String] = ["subject": subject, "text": text ?? "", "html": html ?? "", "from": from]
        guard let r = rule()?.call(withArguments: [input]), r.isObject else { return nil }
        return r.forProperty("spam").toBool()
    }

    func run(_ items: [Item], session: Session) async {
        let todo = items.filter { !$0.checked && $0.folder == "inbox" && !$0.sealedEnd && !running.contains($0.id) }
        guard !todo.isEmpty else { return }
        todo.forEach { running.insert($0.id) }
        defer { todo.forEach { running.remove($0.id) } }
        let me = session.user.address
        let ok = Self.trusted(me)
        // Conferência que começou e não terminou (app fechado no meio): a próxima não abre o corpo dela de novo.
        let busyKey = "spam-busy:\(me.lowercased())"
        let stuck = UserDefaults.standard.string(forKey: busyKey)
        var spam: [String] = []
        var clean: [String] = []
        for i in todo {
            let from = i.h.from?.address.lowercased() ?? ""
            if !from.isEmpty, i.h.auth == "pass", ok.contains(Self.tag(from, session)) { clean.append(i.id); continue }
            var verdict = isSpam(subject: i.h.subject, text: i.h.snippet, html: nil, from: from)
            // Corpo que não abre fica com o veredito do assunto e da prévia, sem conferir de novo a cada lista.
            if verdict == false, i.size <= Self.bodyMax, stuck != i.id {
                // A marca cobre só abrir e conferir, não o download (download lento não é conferência travada).
                let id = i.id
                if let email = try? await Mailbox.shared.read(i, session: session, keep: false, onFetched: { UserDefaults.standard.set(id, forKey: busyKey) }) {
                    verdict = isSpam(subject: email.subject.isEmpty ? i.h.subject : email.subject, text: email.text, html: email.html, from: from)
                }
                UserDefaults.standard.removeObject(forKey: busyKey)
            }
            // Sem a regra, nada é movido nem marcado: confere quando ela voltar.
            guard let v = verdict else { continue }
            if v { spam.append(i.id) } else { clean.append(i.id) }
        }
        if !spam.isEmpty { _ = try? await Mailbox.shared.update(spam, folder: "spam") }
        if !clean.isEmpty { _ = try? await Mailbox.shared.update(clean, checked: true) }
    }

    // Impressão do endereço com uma chave tirada da chave da conta: a lista no aparelho não mostra com quem a pessoa
    // se corresponde.
    private static func tag(_ address: String, _ session: Session) -> String {
        let key = SymmetricKey(data: SHA256.hash(data: Data("shalom-spam-ok".utf8) + session.secretKey))
        return String(Data(HMAC<SHA256>.authenticationCode(for: Data(address.lowercased().utf8), using: key)).base64EncodedString().prefix(22))
    }

    private static func key(_ me: String) -> String { "spam-ok:\(me.lowercased())" }
    static func trusted(_ me: String) -> Set<String> { Set(UserDefaults.standard.stringArray(forKey: key(me)) ?? []) }

    // Só "Não é spam" (do Spam para a Entrada) e só remetente que o domínio confirmou (DMARC aprovado).
    static func trust(_ items: [Item], session: Session) {
        let tags = items.filter { $0.folder == "spam" && !$0.spoofed && $0.h.auth == "pass" }.compactMap { $0.h.from?.address }.map { tag($0, session) }
        guard !tags.isEmpty else { return }
        let me = session.user.address
        var seen = Set<String>()
        let list = (tags + (UserDefaults.standard.stringArray(forKey: key(me)) ?? [])).filter { seen.insert($0).inserted }
        UserDefaults.standard.set(Array(list.prefix(500)), forKey: key(me))
    }
}
