// Regra de senha do app igual à do site (web/src/lib/password.ts): mínimo de 6 caracteres e recusa só as muito
// fáceis. O medidor zxcvbn roda no JavaScriptCore a partir de Resources/zxcvbn.js.
import XCTest
@testable import ShalomMail

final class PasswordStrengthTests: XCTestCase {
    func testRule() async {
        let checker = PasswordStrength.shared
        let cases: [(String, Bool)] = [
            ("12345", false),               // menos de 6
            ("12345678", false),            // sequência
            ("senha123", false),            // palavra comum com número
            ("thomaz2026", false),          // o próprio nome com ano
            ("marina", false),              // nome comum
            ("x7#kQ2", true),               // curta, mas aleatória
            ("gato-azul-27", true),
            ("lua-cheia-sobre-o-rio-2027", true),
        ]
        for (pw, ok) in cases {
            let r = await checker.check(pw, inputs: ["Thomaz", "thomaz"])
            XCTAssertEqual(r.ok, ok, "\(pw): \(r.hint)")
        }
        let short = await checker.check("abc", inputs: [])
        XCTAssertEqual(short.hint, "pw.min")
        let easy = await checker.check("senha123", inputs: [])
        XCTAssertEqual(easy.hint, "pw.weak")
    }
}
