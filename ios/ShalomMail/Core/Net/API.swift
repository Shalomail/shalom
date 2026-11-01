// A mesma API do app web (/api): cookie de sessão por vaga de conta, cabeçalho X-Shalom em todo pedido
// (o servidor recusa sem ele) e erros traduzidos pelo código, como web/src/i18n/errors.ts.
// O endereço é shalomail.com; na versão de teste (Debug), `-api http://127.0.0.1:8790` aponta para o Worker local.
import Foundation
import Security

struct APIError: LocalizedError, Equatable {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

extension Notification.Name {
    // Sessão que acabou no servidor no meio do uso (ou conta suspensa): o app volta para a tela de entrar.
    static let signedOut = Notification.Name("shalom.signed-out")
}

final class API {
    static let shared = API()

    let base: URL
    var slot = 0
    let session: URLSession
    let cookies: CookieJar

    private init() {
        #if DEBUG
        base = URL(string: UserDefaults.standard.string(forKey: "api") ?? "https://shalomail.com")!
        #else
        // A versão da loja fala só com shalomail.com (o `-api` é só para os testes).
        base = URL(string: "https://shalomail.com")!
        #endif
        cookies = CookieJar(importingFrom: base)
        let cfg = URLSessionConfiguration.default
        // Os cookies vão à mão, do Keychain (CookieJar), e não pelo armazenamento do sistema.
        cfg.httpCookieStorage = nil
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.urlCache = nil
        cfg.timeoutIntervalForRequest = 30
        session = URLSession(configuration: cfg)
    }

    var origin: String { "\(base.scheme ?? "https")://\(base.host ?? "")\(base.port.map { ":\($0)" } ?? "")" }

    func url(_ path: String) -> URL { URL(string: "\(base.absoluteString)/api\(path)")! }

    private func request(_ path: String, method: String, body: Data?, anonymous: Bool) -> URLRequest {
        var req = URLRequest(url: url(path))
        req.httpMethod = method
        req.setValue("1", forHTTPHeaderField: "x-shalom")
        if !anonymous {
            req.setValue(String(slot), forHTTPHeaderField: "x-shalom-slot")
            if let cookie = cookies.header { req.setValue(cookie, forHTTPHeaderField: "Cookie") }
        }
        req.httpShouldHandleCookies = false
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "content-type") }
        return req
    }

    private func send(_ req: URLRequest, again: Bool = false) async throws -> (Data, HTTPURLResponse) {
        #if DEBUG
        // Só nos testes: rede lenta de mentira (`-shalom-net-delay 0.8`), para pegar o que aparece na tela
        // enquanto a resposta não chega. Contra o Worker local a resposta chega rápido demais para isso.
        if let delay = Double(UserDefaults.standard.string(forKey: "shalom-net-delay") ?? ""), delay > 0 {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        #endif
        let data: Data, res: URLResponse
        do { (data, res) = try await session.data(for: req) } catch {
            throw APIError(status: 0, code: "offline", message: t("err.offline"))
        }
        guard let http = res as? HTTPURLResponse else { throw APIError(status: 0, code: "offline", message: t("err.offline")) }
        if req.value(forHTTPHeaderField: "x-shalom-slot") != nil { cookies.take(http, url: req.url ?? base) }
        guard (200 ..< 300).contains(http.statusCode) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = obj?["error"] as? String ?? "http"
            let err = APIError(status: http.statusCode, code: code, message: ErrorText.message(code, obj?["message"] as? String))
            if (http.statusCode == 401 && code == "no_session") || (http.statusCode == 403 && code == "suspended") {
                await MainActor.run { NotificationCenter.default.post(name: .signedOut, object: err) }
            }
            // Ação perigosa sem a pessoa confirmada: pede a senha (Reauth) e manda de novo, uma vez.
            if http.statusCode == 403 && code == "reauth" && !again, await Reauth.shared.ask() { return try await send(req, again: true) }
            throw err
        }
        return (data, http)
    }

    // Corpo e resposta em JSON. Sem corpo: GET.
    @discardableResult
    func call(_ path: String, _ body: [String: Any]? = nil, method: String? = nil, anonymous: Bool = false) async throws -> [String: Any] {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let (out, _) = try await send(request(path, method: method ?? (body == nil ? "GET" : "POST"), body: data, anonymous: anonymous))
        return (try? JSONSerialization.jsonObject(with: out)) as? [String: Any] ?? [:]
    }

    func decode<T: Decodable>(_ type: T.Type, _ path: String, _ body: [String: Any]? = nil, anonymous: Bool = false) async throws -> T {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let (out, _) = try await send(request(path, method: body == nil ? "GET" : "POST", body: data, anonymous: anonymous))
        return try JSONDecoder().decode(T.self, from: out)
    }

    func bytes(_ path: String) async throws -> Data {
        try await send(request(path, method: "GET", body: nil, anonymous: false)).0
    }

    // POST com corpo em JSON e resposta em bytes, com o tipo (o proxy de imagens).
    func postBytes(_ path: String, _ body: [String: Any]) async throws -> (data: Data, type: String) {
        let (out, res) = try await send(request(path, method: "POST", body: try JSONSerialization.data(withJSONObject: body), anonymous: false))
        return (out, (res.value(forHTTPHeaderField: "content-type") ?? "").components(separatedBy: ";")[0].trimmingCharacters(in: .whitespaces))
    }
}

// Cookies de sessão no Keychain, presos a este aparelho: ficam fora do backup e não passam para outro iPhone.
// No armazenamento do sistema eles iam para Library/Cookies, que entra no backup, e quem pegasse um backup
// tinha a sessão aberta. O nome do cookie já diz a vaga da conta (shalom_sid, shalom_sid1...).
final class CookieJar {
    private static let service = "com.shalomail.app.cookies"
    private var values: [String: String]
    private let lock = NSLock()

    init(importingFrom url: URL) {
        values = Self.load()
        // Quem já usava o app: os cookies do armazenamento antigo vêm para cá uma vez e saem de lá.
        let old = HTTPCookieStorage.shared.cookies(for: url) ?? []
        guard !old.isEmpty else { return }
        for c in old where (c.expiresDate ?? .distantFuture) > Date() && values[c.name] == nil { values[c.name] = c.value }
        old.forEach(HTTPCookieStorage.shared.deleteCookie)
        save()
    }

    var header: String? {
        lock.withLock { values.isEmpty ? nil : values.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "; ") }
    }

    // Set-Cookie da resposta: cookie novo entra, cookie apagado pelo servidor (vazio ou vencido) sai.
    func take(_ res: HTTPURLResponse, url: URL) {
        let fields = res.allHeaderFields.reduce(into: [String: String]()) { if let k = $1.key as? String, let v = $1.value as? String { $0[k] = v } }
        let got = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
        guard !got.isEmpty else { return }
        lock.withLock {
            for c in got {
                if c.value.isEmpty || (c.expiresDate.map { $0 <= Date() } ?? false) { values[c.name] = nil } else { values[c.name] = c.value }
            }
        }
        save()
    }

    private static func load() -> [String: String] {
        var out: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "jar", kSecReturnData as String: true]
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    private func save() {
        let data = lock.withLock { try? JSONEncoder().encode(values) } ?? Data()
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "jar"]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        // Depois do primeiro desbloqueio, para o app falar com o servidor também com a tela bloqueada.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

// Tradução dos erros do servidor pelo código, igual ao web (web/src/i18n/errors.ts). Quando o mesmo
// código tem mais de um caso, o texto em português do servidor diz qual é.
enum ErrorText {
    static func message(_ code: String, _ server: String?) -> String {
        let m = server ?? ""
        func has(_ words: String...) -> Bool { words.contains { m.contains($0) } }
        let firstNumber = m.range(of: "\\d+", options: .regularExpression).map { String(m[$0]) }
        let address = m.range(of: "[^\\s@]+@[^\\s@]+\\.[a-z0-9-]+", options: [.regularExpression, .caseInsensitive]).map { String(m[$0]) }
        let key: String?
        var vars: [String: Any] = [:]
        switch code {
        case "too_many": key = has("contas criadas") ? "err.too_many_signups" : has("trocas") ? "err.too_many_changes" : has("envios") ? "err.too_many_sends" : "err.too_many"
        case "wrong": key = has("Endereço ou senha") ? "err.wrong_login" : has("senha atual") ? "err.wrong_current" : has("Código") ? "err.wrong_totp" : "err.wrong"
        case "no_session": key = has("inatividade") ? "mailbox.idleOut" : has("acabou") ? "err.session_over" : "err.no_session"
        case "slow_down": key = has("envios") ? "err.slow_sends" : has("imagens") ? "err.slow_images" : has("consultas") ? "err.slow_lookups" : has("entregas") ? "err.slow_deliveries" : "err.slow_down"
        case "taken": key = has("acabou de ser") ? "err.taken_now" : "auth.addrTaken"
        case "locked": key = has("15") ? "err.locked_15" : "err.locked_hour"
        case "wrong_second": key = has("PIN ou") ? "err.wrong_pin_code" : has("PIN") ? "err.wrong_pin" : "err.wrong_code"
        case "link": key = has("configurações") ? "err.link_settings" : "err.link"
        case "bad_request": key = has("Escreva um nome") ? "err.name_required" : has("PIN tem") ? "err.pin_digits" : "err.bad_request"
        case "too_big": key = has("Foto") ? "err.too_big_photo" : has("Imagem") ? "err.too_big_image" : "err.too_big_message"
        case "state": key = has("desligada") ? "err.state_off" : "err.state_restart"
        case "none": key = "err.no_recovery"
        case "send_limit":
            guard let n = firstNumber else { key = nil; break }
            key = has("fora do Shalom") ? "err.send_limit_external" : "err.send_limit"; vars["n"] = n
        case "too_many_recipients": key = firstNumber == nil ? nil : "err.too_many_recipients"; vars["n"] = firstNumber ?? ""
        case "bad_recipient":
            if has("Contas Shalom") { key = "err.bad_recipient_internal" } else if has("Destino") { key = "err.bad_destination" } else if let a = m.range(of: ":\\s*(.+)$", options: .regularExpression) {
                key = "err.bad_recipient"; vars["address"] = m[a].dropFirst().trimmingCharacters(in: .whitespaces)
            } else { key = nil }
        case "full": key = has("Sua caixa") ? "err.full" : address == nil ? nil : "err.full_recipient"; vars["address"] = address ?? ""
        case "recipient_busy", "no_such_user": key = address == nil ? nil : "err.\(code)"; vars["address"] = address ?? ""
        case "bad_token": key = has("vencido") ? "err.bad_token_expired" : "err.bad_token"
        case "confirm": key = "err.confirm_address"
        case "stripe_error": key = has("nada foi apagado") ? "err.delete_stripe" : nil
        case "offline", "captcha", "invite", "bad_address", "paused", "wrong_captcha", "ticket", "bad_type", "already", "bad_email", "own_domain",
             "bad_folder", "not_found", "bad_cursor", "send_limit_all", "send_failed", "img_failed", "token_used", "bad_seal", "csrf", "suspended",
             "maintenance", "internal":
            key = code == "offline" ? "err.offline" : "err.\(code)"
        default: key = nil
        }
        if let key, L10n.shared.t(key, vars) != key { return L10n.shared.t(key, vars) }
        return server ?? t("err.internal")
    }
}
