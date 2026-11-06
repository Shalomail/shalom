// A regra de spam do aparelho como o app a roda: Resources/spam.js num JavaScriptCore, que não tem URL nem outras
// APIs de navegador (shared/spam.ts precisa funcionar sem elas).
import JavaScriptCore
import XCTest
@testable import ShalomMail

final class SpamRuleTests: XCTestCase {
    func testBundledRule() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "spam", withExtension: "js"))
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript(try String(contentsOf: url, encoding: .utf8))
        let rule = try XCTUnwrap(context.objectForKeyedSubscript("shalomSpam"))
        func spam(_ subject: String, _ html: String) -> Bool {
            rule.call(withArguments: [["subject": subject, "html": html, "from": "aviso@banco.com.br"]]).forProperty("spam").toBool()
        }
        // Link que mostra o banco e leva para outro lugar, mesmo com o texto dentro de outra tag ou com "banco@".
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a href="https://evil.io/x">banco.com.br</a>"#))
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a href="https://evil.io/x"><span>banco.com.br</span></a>"#))
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a href="https://banco.com.br@evil.io/x">banco.com.br</a>"#))
        XCTAssertFalse(spam("Sua fatura fechou", #"<a href="https://www.banco.com.br/fatura">banco.com.br</a>"#))
        // Domínio parecido, quebra de linha dentro do link e atributo falso antes do href de verdade.
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a href="https://xbanco.com.br/x">banco.com.br</a>"#))
        XCTAssertTrue(spam("Sua conta foi bloqueada", "<a href=\"https://banco.com.br\n.evil.io/\">banco.com.br</a>"))
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a data-href="https://banco.com.br" href="https://evil.io">banco.com.br</a>"#))
        XCTAssertTrue(spam("Sua conta foi bloqueada", #"<a title=" href=https://banco.com.br" href="https://evil.io">banco.com.br</a>"#))
        XCTAssertFalse(spam("Sua fatura fechou", #"<a href="https://fatura.banco.com.br:8443/x">banco.com.br</a>"#))
        // HTML montado para travar a conta termina rápido.
        let start = Date()
        _ = spam("oi", "<a " + String(repeating: "href=http://", count: 20_000))
        _ = spam("oi", String(repeating: "<", count: 1_000_000))
        XCTAssertLessThan(Date().timeIntervalSince(start), 3)
    }
}
