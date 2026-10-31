// A mesma API do app web (/api): cookie de sessão por vaga de conta, cabeçalho X-Shalom em todo pedido
// (o servidor recusa sem ele) e erros traduzidos pelo código, como web/src/i18n/errors.ts.
// O endereço padrão é shalomail.com; para testar contra o Worker local, abrir com `-api http://127.0.0.1:8790`.
import Foundation

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

    private init() {
        base = URL(string: UserDefaults.standard.string(forKey: "api") ?? "https://shalomail.com")!
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = .shared
        cfg.httpCookieAcceptPolicy = .always
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
        if !anonymous { req.setValue(String(slot), forHTTPHeaderField: "x-shalom-slot") }
        req.httpShouldHandleCookies = !anonymous
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "content-type") }
        return req
    }

    private func send(_ req: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data, res: URLResponse
        do { (data, res) = try await session.data(for: req) } catch {
            throw APIError(status: 0, code: "offline", message: t("err.offline"))
        }
        guard let http = res as? HTTPURLResponse else { throw APIError(status: 0, code: "offline", message: t("err.offline")) }
        guard (200 ..< 300).contains(http.statusCode) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = obj?["error"] as? String ?? "http"
            let err = APIError(status: http.statusCode, code: code, message: ErrorText.message(code, obj?["message"] as? String))
            if (http.statusCode == 401 && code == "no_session") || (http.statusCode == 403 && code == "suspended") {
                await MainActor.run { NotificationCenter.default.post(name: .signedOut, object: err) }
            }
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
