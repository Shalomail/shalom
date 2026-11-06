// Capturas para a App Store, com a caixa de demonstração de scripts/store-seed.ts (emma em inglês, ana em
// português). Só roda quando pedido: TEST_RUNNER_SHALOM_STORE=en (ou pt) e TEST_RUNNER_SHALOM_PASSWORD no
// xcodebuild. As listas saem antes de abrir qualquer conversa, para o claro e o escuro mostrarem as mesmas
// não lidas. As capturas ficam no resultado do teste (xcresulttool export attachments). Antes, no simulador:
// barra de status em 9:41 (simctl status_bar override) e corretor e sugestões do teclado desligados
// (KeyboardCheckSpelling e KeyboardPrediction em com.apple.keyboard.preferences), senão o texto em inglês
// sai sublinhado pelo dicionário do teclado do Mac.
import XCTest

final class StoreShots: XCTestCase {
    struct Copy {
        let user, lang, appleLang, thread, spoof, to, subject, body: String
        let compose, discard, settings, accountPrefix: String
    }

    static let en = Copy(
        user: "emma", lang: "en", appleLang: "(en)", thread: "Noah Bennett", spoof: "Urgent: verify your account within 24 hours",
        to: "sofia@shalomail.com", subject: "Beach on Saturday? 🌊",
        body: "Hey Sofia! 👋\n\nThe Lisbon photos are amazing 😍 Beach on Saturday? I'll bring the snacks 🍉🥪\n\nSee you soon ✨",
        compose: "Compose", discard: "Discard", settings: "Settings", accountPrefix: "Account:")
    static let pt = Copy(
        user: "ana", lang: "pt", appleLang: "(pt-BR)", thread: "Lia Moraes", spoof: "Urgente: confirme seus dados em 24 horas",
        to: "pedro@shalomail.com", subject: "Praia no sábado? 🌊",
        body: "Oi, Pedro! 👋\n\nAs fotos de Lisboa ficaram lindas 😍 Praia no sábado? Eu levo os lanches 🍉🥪\n\nAté logo ✨",
        compose: "Escrever", discard: "Descartar", settings: "Configurações", accountPrefix: "Conta:")

    var copy: Copy!
    var password = ""
    // TEST_RUNNER_SHALOM_STORE_THEMES=light tira só o claro.
    var themes = ["light", "dark"]

    override func setUpWithError() throws {
        let env = ProcessInfo.processInfo.environment
        guard let lang = env["SHALOM_STORE"], let p = env["SHALOM_PASSWORD"], !p.isEmpty else {
            throw XCTSkip("capturas da loja: rodar com TEST_RUNNER_SHALOM_STORE e TEST_RUNNER_SHALOM_PASSWORD")
        }
        copy = lang == "pt" ? Self.pt : Self.en
        password = p
        if let t = env["SHALOM_STORE_THEMES"] { themes = t.split(separator: ",").map(String.init) }
        continueAfterFailure = false
    }

    func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = "\(copy.lang)-\(name)"
        a.lifetime = .keepAlways
        add(a)
    }

    func launch(_ theme: String) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", copy.lang, "-shalom-accounts", "",
                               "-AppleLanguages", copy.appleLang, "-shalom-theme", theme]
        app.launch()
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap(); address.typeText("\(copy.user)\n")
        let field = app.secureTextFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap(); field.typeText("\(password)\n")
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 60))
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Permitir"])).firstMatch
        if allow.waitForExistence(timeout: 4) { allow.tap() }
        sleep(3)
        return app
    }

    func testStoreShots() throws {
        // Listas, nos dois temas.
        for theme in themes {
            let app = try launch(theme)
            shot("1-inbox-\(theme)")
            app.buttons["Spam"].tap()
            sleep(3)
            shot("4-spam-\(theme)")
            app.terminate()
        }

        // Leitura, escrita, aviso de golpe e segurança.
        for theme in themes {
            let app = try launch(theme)
            app.staticTexts[copy.thread].firstMatch.tap()
            sleep(4)
            shot("2-thread-\(theme)")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            sleep(2)

            app.buttons[copy.compose].tap()
            let to = app.textFields.firstMatch
            XCTAssertTrue(to.waitForExistence(timeout: 10))
            to.tap(); to.typeText("\(copy.to),")
            let subject = app.textFields.element(boundBy: 1)
            subject.tap(); subject.typeText(copy.subject)
            let body = app.textViews.firstMatch
            body.tap(); body.typeText(copy.body)
            sleep(3)
            shot("3-compose-\(theme)")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            let discard = app.buttons[copy.discard]
            if discard.waitForExistence(timeout: 5) { discard.tap() }
            sleep(2)

            app.buttons["Spam"].tap()
            sleep(2)
            app.staticTexts[copy.spoof].firstMatch.tap()
            sleep(4)
            shot("5-scam-warning-\(theme)")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            sleep(1)

            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", copy.accountPrefix)).firstMatch.tap()
            app.buttons[copy.settings].tap()
            XCTAssertTrue(app.navigationBars[copy.settings].waitForExistence(timeout: 10))
            sleep(3)
            shot("6-settings-\(theme)")
            app.swipeUp(velocity: .slow)
            sleep(2)
            shot("6-settings-security-\(theme)")
            app.terminate()
        }
    }
}
