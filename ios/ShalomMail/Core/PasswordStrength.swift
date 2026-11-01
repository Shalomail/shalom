// Força da senha com o mesmo medidor do site (web/src/lib/password.ts): mínimo de 6 caracteres e recusa só as
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

    func check(_ pw: String, inputs: [String]) -> Result {
        if pw.count < 6 { return Result(ok: false, hint: "pw.min") }
        // Sem o medidor (arquivo faltando), vale só o mínimo.
        guard let r = checker()?.call(withArguments: [pw, inputs.filter { !$0.isEmpty }]), r.isObject else { return Result(ok: true, hint: "pw.hint") }
        if r.forProperty("easy").toBool() { return Result(ok: false, hint: "pw.weak") }
        switch r.forProperty("score").toInt32() {
        case ...2: return Result(ok: true, hint: "pw.fair")
        case 3: return Result(ok: true, hint: "pw.good")
        default: return Result(ok: true, hint: "pw.strong")
        }
    }
}
