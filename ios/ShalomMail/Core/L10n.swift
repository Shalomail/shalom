// Textos nas 15 línguas, os mesmos do app web (scripts/ios-strings.ts gera Resources/Strings/<idioma>.json).
// {nome} é trocado pelo valor; plural escolhe a forma pela regra de cada idioma. O idioma segue o do
// iPhone, ou o escolhido nas Configurações do app (vale na hora, sem reabrir).
import Foundation
import SwiftUI

final class L10n: ObservableObject {
    static let shared = L10n()
    static let supported = ["pt", "en", "es", "fr", "de", "it", "ru", "uk", "tr", "he", "ar", "hi", "zh", "ja", "ko"]
    private static let storeKey = "shalom-app-lang"

    @Published private(set) var lang: String
    private var dict: [String: Any] = [:]
    private var fallback: [String: Any] = [:]

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.storeKey)
        let device = Locale.preferredLanguages.lazy.map { String($0.prefix(2)) }.first { Self.supported.contains($0) }
        lang = saved.flatMap { Self.supported.contains($0) ? $0 : nil } ?? device ?? "en"
        fallback = Self.load("en")
        dict = Self.load(lang)
    }

    private static func load(_ lang: String) -> [String: Any] {
        guard let url = Bundle.main.url(forResource: lang, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    func set(_ lang: String) {
        guard Self.supported.contains(lang) else { return }
        UserDefaults.standard.set(lang, forKey: Self.storeKey)
        dict = Self.load(lang)
        self.lang = lang
    }

    var isRTL: Bool { lang == "he" || lang == "ar" }
    var locale: Locale { Locale(identifier: lang == "pt" ? "pt-BR" : lang) }

    func t(_ key: String, _ vars: [String: Any] = [:]) -> String {
        let s = (dict[key] as? String) ?? (fallback[key] as? String) ?? key
        return fill(strip(s), vars)
    }

    func tn(_ key: String, _ n: Int, _ vars: [String: Any] = [:]) -> String {
        guard let forms = (dict[key] as? [String: String]) ?? (fallback[key] as? [String: String]) else { return key }
        let form = forms[Self.category(lang, n)] ?? forms["other"] ?? key
        var v = vars; v["n"] = NumberFormatter.localizedString(from: NSNumber(value: n), number: .decimal)
        return fill(strip(form), v)
    }

    private func fill(_ s: String, _ vars: [String: Any]) -> String {
        vars.reduce(s) { $0.replacingOccurrences(of: "{\($1.key)}", with: "\($1.value)") }
    }

    // Texto com <marca>trecho</marca> do web: cada marca que tiver endereço em links vira link (o resto, texto).
    func linked(_ key: String, _ links: [String: URL]) -> AttributedString {
        let s = (dict[key] as? String) ?? (fallback[key] as? String) ?? key
        var out = AttributedString()
        var rest = Substring(s)
        while let open = rest.range(of: "<([a-zA-Z]+)>", options: .regularExpression) {
            let tag = String(rest[open].dropFirst().dropLast())
            out += AttributedString(String(rest[..<open.lowerBound]))
            guard let close = rest.range(of: "</\(tag)>", range: open.upperBound ..< rest.endIndex) else { rest = rest[open.upperBound...]; continue }
            var part = AttributedString(String(rest[open.upperBound ..< close.lowerBound]))
            if let url = links[tag] { part.link = url; part.underlineStyle = .single }
            out += part
            rest = rest[close.upperBound...]
        }
        out += AttributedString(String(rest))
        return out
    }

    // Páginas do site no idioma do app: o português fica na raiz (shalomail.com/privacidade/).
    enum Page { case privacy, terms, help }
    func site(_ page: Page) -> URL {
        let path: String
        switch page {
        case .privacy: path = lang == "pt" ? "privacidade" : "\(lang)/privacy"
        case .terms: path = lang == "pt" ? "termos" : "\(lang)/terms"
        case .help: path = lang == "pt" ? "perguntas-frequentes" : "\(lang)/faq"
        }
        return URL(string: "https://shalomail.com/\(path)/")!
    }

    // <marca>texto</marca> do web vira só o texto (os links ficam a cargo de quem chama, quando precisar).
    private func strip(_ s: String) -> String {
        s.replacingOccurrences(of: "</?[a-zA-Z]+>", with: "", options: .regularExpression)
    }

    // Regras de plural do CLDR para as 15 línguas.
    static func category(_ lang: String, _ n: Int) -> String {
        let m10 = n % 10, m100 = n % 100
        switch lang {
        case "zh", "ja", "ko": return "other"
        case "fr", "hi", "pt": return n == 0 || n == 1 ? "one" : "other"
        case "ru", "uk":
            if m10 == 1 && m100 != 11 { return "one" }
            if (2 ... 4).contains(m10) && !(12 ... 14).contains(m100) { return "few" }
            return "many"
        case "he": return n == 1 ? "one" : n == 2 ? "two" : "other"
        case "ar":
            if n == 0 { return "zero" }; if n == 1 { return "one" }; if n == 2 { return "two" }
            if (3 ... 10).contains(m100) { return "few" }; if (11 ... 99).contains(m100) { return "many" }
            return "other"
        default: return n == 1 ? "one" : "other"
        }
    }
}

func t(_ key: String, _ vars: [String: Any] = [:]) -> String { L10n.shared.t(key, vars) }
func tn(_ key: String, _ n: Int, _ vars: [String: Any] = [:]) -> String { L10n.shared.tn(key, n, vars) }
