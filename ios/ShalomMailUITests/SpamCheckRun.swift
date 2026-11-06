// Filtro de spam no aparelho (SpamCheck), de ponta a ponta: entra na conta de demonstração (ana, de
// scripts/store-seed.ts) e espera a Entrada conferir o que chegou de fora. Quem confere o resultado é o script
// que mandou os e-mails, pelo servidor local. Só roda quando pedido: TEST_RUNNER_SHALOM_SPAMCHECK=1 e
// TEST_RUNNER_SHALOM_PASSWORD no xcodebuild.
import XCTest

final class SpamCheckRun: XCTestCase {
    func testInboxIsChecked() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["SHALOM_SPAMCHECK"] == "1", let password = env["SHALOM_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("filtro de spam: rodar com TEST_RUNNER_SHALOM_SPAMCHECK=1 e TEST_RUNNER_SHALOM_PASSWORD")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap(); address.typeText("ana\n")
        let field = app.secureTextFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap(); field.typeText("\(password)\n")
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 60))
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Permitir"])).firstMatch
        if allow.waitForExistence(timeout: 4) { allow.tap() }
        sleep(10)
    }
}
