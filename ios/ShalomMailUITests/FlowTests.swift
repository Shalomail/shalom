// Fluxo de verdade contra o Worker local (127.0.0.1:8790), com as contas de teste do seed (marina e lia):
// entrar, ver a caixa, abrir uma conversa. A senha delas vem de fora (TEST_RUNNER_SHALOM_PASSWORD no
// xcodebuild), para não ir na cópia pública do código. As capturas ficam no resultado do teste
// (xcresulttool export attachments).
import XCTest

final class FlowTests: XCTestCase {
    func seedPassword() throws -> String {
        guard let p = ProcessInfo.processInfo.environment["SHALOM_PASSWORD"], !p.isEmpty else {
            throw XCTSkip("sem senha das contas de teste: rodar com TEST_RUNNER_SHALOM_PASSWORD")
        }
        return p
    }

    // A pergunta do iPhone sobre avisos aparece na primeira vez que a caixa abre: o teste aceita.
    override func setUp() {
        addUIInterruptionMonitor(withDescription: "avisos") { alert in
            let allow = alert.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Permitir"])).firstMatch
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
    }

    func allowNotifications() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "Permitir"])).firstMatch
        if allow.waitForExistence(timeout: 5) { allow.tap() }
    }

    func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    func testSignInAndRead() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()

        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        shot(app, "1-entrar")
        address.tap()
        address.typeText("marina\n")

        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        shot(app, "2-senha")
        password.tap()
        password.typeText("\(try seedPassword())\n")

        // Argon2id de 128 MiB e a primeira lista: espera a caixa aparecer.
        let firstRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread-'")).firstMatch
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 60), "a caixa abriu")
        allowNotifications()
        sleep(3)
        shot(app, "3-caixa")

        let cell = list.cells.firstMatch
        if cell.waitForExistence(timeout: 10) {
            cell.tap()
            sleep(4)
            shot(app, "4-conversa")
        }
        _ = firstRow
    }

    func testSendToShalomAccount() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap(); address.typeText("marina\n")
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        password.tap(); password.typeText("\(try seedPassword())\n")
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 60))
        allowNotifications()

        app.buttons["Escrever"].tap()
        let to = app.textFields.element(boundBy: 0)
        XCTAssertTrue(to.waitForExistence(timeout: 10))
        to.tap(); to.typeText("lia,")
        let subject = app.textFields["Assunto"]
        subject.tap(); subject.typeText("Teste do iPhone")
        let body = app.textViews.firstMatch
        body.tap(); body.typeText("Mensagem lacrada no iPhone, com acentuação: ção.")
        sleep(1)
        shot(app, "5-escrever")
        app.buttons["Enviar"].tap()
        XCTAssertTrue(app.staticTexts["Enviada, fechada de ponta a ponta."].waitForExistence(timeout: 40), "aviso de enviada lacrada")
        shot(app, "6-enviada")
    }

    func signIn(_ app: XCUIApplication, _ who: String) throws {
        let address = app.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15))
        address.tap(); address.typeText("\(who)\n")
        let password = app.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15))
        password.tap(); password.typeText("\(try seedPassword())\n")
        XCTAssertTrue(app.collectionViews.firstMatch.waitForExistence(timeout: 60))
        allowNotifications()
    }

    // Avisos: o iPhone pergunta, a pessoa aceita e a chave aparece ligada nas Configurações. O token que a
    // Apple deu ao simulador vai para o servidor (conferido depois em push_tokens no banco local).
    func testNotifications() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        try signIn(app, "marina")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conta:")).firstMatch.tap()
        app.buttons["Configurações"].tap()
        XCTAssertTrue(app.navigationBars["Configurações"].waitForExistence(timeout: 10))
        let toggle = app.switches["Avisar quando chegar mensagem"]
        for _ in 0 ..< 4 where !toggle.isHittable { app.swipeUp(); sleep(1) }
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), "chave dos avisos")
        XCTAssertEqual(toggle.value as? String, "1", "avisos ligados depois de aceitar")
        shot(app, "10-avisos")
    }

    // Links que abrem no app: senha nova pelo e-mail de recuperação e conectar o terminal. Os links vêm de
    // scripts/ios-links-check.ts prep (TEST_RUNNER_RESET_URL e TEST_RUNNER_CONNECT_URL); o verify confere depois.
    func testLinks() throws {
        let env = ProcessInfo.processInfo.environment
        guard let reset = env["RESET_URL"].flatMap(URL.init(string:)), let connect = env["CONNECT_URL"].flatMap(URL.init(string:)) else {
            throw XCTSkip("sem links: rodar scripts/ios-links-check.ts prep antes")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 15))

        openLink(reset)
        let password = app.secureTextFields["Senha nova"]
        XCTAssertTrue(password.waitForExistence(timeout: 15), "tela de senha nova")
        sleep(1)
        shot(app, "11-senha-nova")
        password.tap(); password.typeText("nova-senha-do-iphone-2026")
        let again = app.secureTextFields["A mesma senha"]
        again.tap(); again.typeText("nova-senha-do-iphone-2026")
        app.buttons["Criar senha nova"].tap()
        sleep(10)
        shot(app, "11b-depois-da-senha-nova")
        XCTAssertTrue(app.buttons["Escrever"].waitForExistence(timeout: 60), "a caixa abriu com a senha nova")
        allowNotifications()

        openLink(connect)
        let approve = app.buttons["Conectar"]
        XCTAssertTrue(approve.waitForExistence(timeout: 15), "pedido do terminal")
        sleep(1)
        shot(app, "12-conectar")
        approve.tap()
        XCTAssertTrue(app.staticTexts["Pode voltar para o terminal: ele já recebeu o acesso."].waitForExistence(timeout: 20), "terminal conectado")
        shot(app, "13-conectado")
    }

    func openLink(_ url: URL) {
        XCUIDevice.shared.system.open(url)
        // Link de esquema próprio: o iPhone pode perguntar se abre no app.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let open = springboard.buttons.matching(NSPredicate(format: "label IN %@", ["Open", "Abrir"])).firstMatch
        if open.waitForExistence(timeout: 3) { open.tap() }
    }

    func testSettings() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        try signIn(app, "marina")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conta:")).firstMatch.tap()
        app.buttons["Configurações"].tap()
        XCTAssertTrue(app.navigationBars["Configurações"].waitForExistence(timeout: 10))
        sleep(2)
        shot(app, "7-config")
        app.swipeUp(); sleep(1)
        shot(app, "8-config-2")
        app.swipeUp(); sleep(1)
        shot(app, "9-config-3")
    }

    func testSignUp() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)"]
        app.launch()
        XCTAssertTrue(app.buttons["Criar conta"].waitForExistence(timeout: 15))
        app.buttons["Criar conta"].tap()
        let name = app.textFields["signup-name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10))
        name.tap(); name.typeText("Teste iPhone\n")
        let local = app.textFields["signup-address"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        local.tap(); local.typeText("iphone\(Int(Date().timeIntervalSince1970) % 100000)")
        sleep(2)
        shot(app, "10-cadastro-endereco")
        local.typeText("\n")
        let pw = app.secureTextFields["signup-password"]
        XCTAssertTrue(pw.waitForExistence(timeout: 10))
        pw.tap(); pw.typeText("uma frase longa de teste 2026\n")
        let again = app.secureTextFields["signup-confirm"]
        XCTAssertTrue(again.waitForExistence(timeout: 10))
        again.tap(); again.typeText("uma frase longa de teste 2026")
        sleep(6)
        shot(app, "11-cadastro-confirmar")
        again.typeText("\n")
        XCTAssertTrue(app.staticTexts["E-mail de recuperação"].waitForExistence(timeout: 60), "pergunta do e-mail de recuperação")
        shot(app, "12-recuperacao")
    }
}
