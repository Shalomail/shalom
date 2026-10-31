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

    // Para alguém de fora a mensagem não vai fechada de ponta a ponta: nem no aviso de enviada, nem na cópia
    // de Enviados (antes a cópia aparecia com o selo verde, porque é lacrada por quem enviou), que fica sem
    // linha de segurança.
    func testSendOutsideIsNotSealed() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", "dark"]
        app.launch()
        try signIn(app, "marina")
        let subject = "Para fora \(Int(Date().timeIntervalSince1970) % 100000)"
        app.buttons["Escrever"].tap()
        let to = app.textFields.element(boundBy: 0)
        XCTAssertTrue(to.waitForExistence(timeout: 10))
        to.tap(); to.typeText("carla@empresa.com.br,")
        let subjectField = app.textFields["Assunto"]
        subjectField.tap(); subjectField.typeText(subject)
        let body = app.textViews.firstMatch
        body.tap(); body.typeText("Mensagem comum, para fora do Shalom.")
        app.buttons["Enviar"].tap()
        XCTAssertTrue(app.staticTexts["Mensagem enviada."].waitForExistence(timeout: 40), "aviso de enviada, sem o fechada de ponta a ponta")

        app.buttons["Enviados"].tap()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "a mensagem aparece em Enviados")
        XCTAssertFalse(row.images["Fechado de ponta a ponta."].exists, "sem o cadeado verde na lista")
        row.tap()
        XCTAssertTrue(app.staticTexts["Para: carla@empresa.com.br"].waitForExistence(timeout: 15), "a conversa abriu")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "trancad")).firstMatch.exists, "sem linha de segurança")
        sleep(1)
        shot(app, "19-enviada-para-fora")
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

    // Barra de baixo, no escuro e no claro: Enviados e Spam pela barra, a Lixeira pelo menu de cima e a volta
    // para a Entrada pelo círculo do meio.
    func testTabBar() throws {
        for theme in ["dark", "light"] {
            let app = XCUIApplication()
            app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", theme]
            app.launch()
            try signIn(app, "marina")
            sleep(2)
            shot(app, "14-barra-\(theme)")
            app.buttons["Enviados"].tap()
            XCTAssertTrue(app.navigationBars["Enviados"].waitForExistence(timeout: 10), "Enviados pela barra")
            sleep(2)
            shot(app, "15-enviados-\(theme)")
            app.buttons["Spam"].tap()
            XCTAssertTrue(app.navigationBars["Spam"].waitForExistence(timeout: 10), "Spam pela barra")
            sleep(2)
            shot(app, "16-spam-\(theme)")
            app.buttons["Abrir menu"].tap()
            let trash = app.buttons["Lixeira"]
            XCTAssertTrue(trash.waitForExistence(timeout: 5), "menu das pastas, em cima")
            for f in ["Entrada", "Favoritos", "Enviados", "Spam"] {
                XCTAssertEqual(app.buttons.matching(identifier: f).count, 1, "\(f) só na barra de baixo, não no menu")
            }
            sleep(1)
            shot(app, "16b-menu-\(theme)")
            trash.tap()
            XCTAssertTrue(app.navigationBars["Lixeira"].waitForExistence(timeout: 10), "Lixeira pelo menu")
            sleep(1)
            shot(app, "17-lixeira-\(theme)")
            app.buttons["Entrada"].tap()
            XCTAssertTrue(app.navigationBars["Entrada"].waitForExistence(timeout: 10), "de volta à Entrada pelo círculo")
            app.terminate()
        }
    }

    // Trocar o tema com as Configurações abertas muda a própria folha na hora (antes só ao fechar e abrir).
    func testThemeSwitch() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", "dark"]
        app.launch()
        try signIn(app, "marina")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conta:")).firstMatch.tap()
        app.buttons["Configurações"].tap()
        XCTAssertTrue(app.navigationBars["Configurações"].waitForExistence(timeout: 10))
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tema do app")).firstMatch
        for _ in 0 ..< 4 where !picker.isHittable { app.swipeUp(); sleep(1) }
        XCTAssertLessThan(brightness(app), 0.2, "folha no escuro")
        picker.tap()
        app.buttons["Claro"].tap()
        sleep(1)
        shot(app, "18-tema-claro")
        XCTAssertGreaterThan(brightness(app), 0.8, "a folha aberta ficou clara na hora")
        picker.tap()
        app.buttons["Escuro"].tap()
        sleep(1)
        XCTAssertLessThan(brightness(app), 0.2, "e voltou para o escuro na hora")
    }

    // Brilho de um ponto do fundo, na borda esquerda e no meio da altura (0 preto, 1 branco).
    func brightness(_ app: XCUIApplication) -> CGFloat {
        guard let img = app.screenshot().image.cgImage else { return -1 }
        let x = Int(Double(img.width) * 0.02), y = img.height / 2
        var px = [UInt8](repeating: 0, count: 4)
        let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.draw(img, in: CGRect(x: -x, y: y - img.height + 1, width: img.width, height: img.height))
        return (CGFloat(px[0]) + CGFloat(px[1]) + CGFloat(px[2])) / 765
    }

    // Trocar de pasta mostra a lista guardada na hora: nem o "vazio" da pasta nova, nem o carregando (era o
    // tropeço que o web já tinha tido). Com a rede lenta de mentira, sem a lista guardada o carregando fica
    // na tela tempo bastante para o teste ver.
    func testFolderSwitchHasNoStaleFrame() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", "dark", "-shalom-net-delay", "0.8"]
        app.launch()
        try signIn(app, "marina")
        sleep(12) // as outras pastas carregam por trás, uma por vez
        for (folder, empty) in [("Spam", "Nenhum spam por aqui."), ("Enviados", "Você ainda não enviou nada."), ("Spam", "Nenhum spam por aqui."), ("Entrada", "Tudo em dia.")] {
            app.buttons[folder].tap()
            XCTAssertFalse(app.activityIndicators.firstMatch.exists, "\(folder): sem carregando na troca")
            XCTAssertFalse(app.staticTexts[empty].exists, "\(folder): sem o vazio na troca")
            XCTAssertTrue(app.collectionViews.cells.firstMatch.exists, "\(folder): a lista já está lá")
        }
    }

    // Espaço e Senha abrem como página dentro das Configurações (antes eram folhas por cima, e fechar
    // arrastando reorganizava os textos de baixo). O Espaço volta pelo gesto da borda; a Senha, só pelo
    // Cancelar.
    func testSettingsPages() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", "dark"]
        app.launch()
        try signIn(app, "marina")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Conta:")).firstMatch.tap()
        app.buttons["Configurações"].tap()
        XCTAssertTrue(app.navigationBars["Configurações"].waitForExistence(timeout: 10))

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Senha")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars.buttons["Cancelar"].waitForExistence(timeout: 10), "Senha abre com Cancelar")
        XCTAssertFalse(app.navigationBars.buttons["Configurações"].exists, "sem a seta de voltar junto do Cancelar")
        app.navigationBars.buttons["Cancelar"].tap()
        XCTAssertTrue(app.navigationBars["Configurações"].waitForExistence(timeout: 10))

        let space = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", " / ")).firstMatch
        for _ in 0 ..< 4 where !space.isHittable { app.swipeUp(); sleep(1) }
        sleep(1)
        space.tap()
        XCTAssertTrue(app.navigationBars["Espaço"].waitForExistence(timeout: 10))
        sleep(2)
        let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        edge.press(forDuration: 0.2, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)), withVelocity: 250, thenHoldForDuration: 0.3)
        sleep(2)
        XCTAssertTrue(app.navigationBars["Configurações"].exists, "de volta às Configurações")
        XCTAssertFalse(app.navigationBars["Espaço"].exists, "o Espaço fechou")
    }

    // Segurar em cima de uma conversa abre as ações da página dela (aqui, fixar e desafixar). Depois abre um
    // e-mail e fotografa o corpo no escuro e no claro (no escuro ele não pode ficar num cartão branco).
    func testThreadMenu() throws {
        for theme in ["dark", "light"] {
            let app = XCUIApplication()
            app.launchArguments = ["-api", "http://127.0.0.1:8790", "-shalom-app-lang", "pt", "-shalom-accounts", "", "-AppleLanguages", "(pt-BR)", "-shalom-theme", theme]
            app.launch()
            try signIn(app, "marina")
            let cell = app.collectionViews.cells.firstMatch
            XCTAssertTrue(cell.waitForExistence(timeout: 10))
            if theme == "dark" {
                cell.press(forDuration: 1.0)
                XCTAssertTrue(app.buttons["Marcar como spam"].waitForExistence(timeout: 5), "menu com as ações da conversa")
                sleep(1)
                shot(app, "20-menu-segurar")
                app.buttons["Fixar"].tap()
                XCTAssertTrue(app.staticTexts["Conversa fixada no topo."].waitForExistence(timeout: 5), "fixou pelo menu")
                sleep(1)
                app.collectionViews.cells.firstMatch.press(forDuration: 1.0)
                XCTAssertTrue(app.buttons["Desafixar"].waitForExistence(timeout: 5))
                app.buttons["Desafixar"].tap()
                XCTAssertTrue(app.staticTexts["Conversa desafixada."].waitForExistence(timeout: 5), "desafixou pelo menu")
                sleep(1)
                // Arrasto até a metade: mostra Apagar (vermelho) e Arquivar, sem apagar.
                let row = app.collectionViews.cells.element(boundBy: 1)
                row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).press(forDuration: 0.1, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5)))
                XCTAssertTrue(app.buttons["Apagar"].waitForExistence(timeout: 5))
                shot(app, "20b-arrastar")
                app.navigationBars.firstMatch.tap()
                sleep(1)
            }
            app.collectionViews.cells.firstMatch.tap()
            sleep(4)
            shot(app, "21-corpo-\(theme)")
            app.terminate()
        }
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
