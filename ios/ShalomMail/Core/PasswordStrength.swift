// Força da senha com o mesmo medidor do site (shared/password.ts): mínimo de 6 caracteres e recusa só as
// muito fáceis (12345678, senha123, nome com ano). O zxcvbn, com os dicionários em português, roda no
// JavaScriptCore a partir de Resources/zxcvbn.js (gerado por scripts/ios-zxcvbn.mjs).
import Foundation
import JavaScriptCore

actor PasswordStrength {
    static let shared = PasswordStrength()

    // hint é a chave do texto (pw.min, pw.weak, pw.fair, pw.good, pw.strong).
    struct Result: Equatable {
        let ok: Bool
        let hint: String
    }

    private var context: JSContext?

    private func checker() -> JSValue? {
        if context == nil, let url = Bundle.main.url(forResource: "zxcvbn", withExtension: "js"), let js = try? String(contentsOf: url, encoding: .utf8) {
            let c = JSContext()
            c?.evaluateScript(js)
            context = c
        }
        return context?.objectForKeyedSubscript("shalomStrength")
    }

    // A conta enquanto a pessoa digita, dentro de um .task(id: senha): espera 250 ms sem tecla nova, para tecla
    // apagada não entrar na fila do medidor, e devolve nil se a senha mudou no meio. Quem decide (avançar, salvar)
    // chama check() com a senha do campo naquela hora, nunca usa este resultado.
    static func live(_ pw: String, inputs: [String]) async -> Result? {
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return nil }
        let r = await shared.check(pw, inputs: inputs)
        return Task.isCancelled ? nil : r
    }

    func check(_ typed: String, inputs: [String]) -> Result {
        // Vale a pior das duas formas, como no medidor (shared/password.ts): a digitada e a NFKC sem invisíveis, a
        // de que o Argon2id deriva a chave (Keys.swift). Um caractere só que vira 18 na NFKC continua curto.
        let plain = String(String.UnicodeScalarView(typed.precomposedStringWithCompatibilityMapping.unicodeScalars.filter { !$0.properties.isDefaultIgnorableCodePoint && $0.value != 0x2800 }))
        let length = min(typed.count, plain.count)
        if length < 6 { return Result(ok: false, hint: "pw.min") }
        // Sem o medidor (arquivo faltando ou erro no JavaScript), só passa frase longa.
        guard let r = checker()?.call(withArguments: [typed, inputs.filter { !$0.isEmpty }]), r.isObject, r.forProperty("score").isNumber else {
            assertionFailure("medidor de senha indisponível")
            return length >= 16 ? Result(ok: true, hint: "pw.hint") : Result(ok: false, hint: "pw.weak")
        }
        if r.forProperty("easy").toBool() { return Result(ok: false, hint: "pw.weak") }
        switch r.forProperty("score").toInt32() {
        case ...2: return Result(ok: true, hint: "pw.fair")
        case 3: return Result(ok: true, hint: "pw.good")
        default: return Result(ok: true, hint: "pw.strong")
        }
    }
}
