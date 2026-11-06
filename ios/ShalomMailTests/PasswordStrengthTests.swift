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
        // A chave nasce da forma NFKC: largura total e letra estilizada valem a senha comum que escondem.
        for pw in ["ｐａｓｓｗｏｒｄ", "ｓｅｎｈａ１２３", "𝐬𝐞𝐧𝐡𝐚𝟏𝟐𝟑", "𝟏𝟐𝟑𝟒𝟓𝟔", "ｔｈｏｍａｚ２０２６"] {
            let r = await checker.check(pw, inputs: ["Thomaz", "thomaz"])
            XCTAssertFalse(r.ok, "\(pw): \(r.hint)")
        }
        // Cada palavra do nome e do endereço conta, nas três telas (cadastro, troca e link de recuperação).
        // Também sem acento, com separador no meio e com as letras separadas dos números do endereço.
        let named: [(String, [String])] = [
            ("ribeiro2026", ["Ana Ribeiro", "ana"]),
            ("moraes1990", ["Lia Moraes", "lia@shalomail.com"]),
            ("mariasilva1990", ["mariasilva@shalomail.com"]),
            ("brandao2026", ["Thaís Brandão", "thais"]),
            ("zanchetta_2026", ["Ana Zanchetta", "ana"]),
            ("zanchetta2026!", ["Ana Zanchetta", "ana"]),
            ("mariasilva1990", ["Maria", "mariasilva90"]),
            ("mariasilva1990", ["Maria", "maria.silva"]),
            // Nome e sobrenome juntos, ou com dois separadores.
            ("ana.zanchetta.2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("Zanchetta_Ana_2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("zanchettaazul2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("davila_2026", ["Ana D'Ávila", "ana"]),
            // Nome disfarçado: pontuação no meio, números no lugar de letras, letra repetida, de trás para frente.
            ("zan.chetta.2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("z4nch3tt4.4n4.2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("zanchettta.ana.2026", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("attehcnaz.ana.2026", ["Ana Zanchetta", "ana@shalomail.com"]),
        ]
        for (pw, inputs) in named {
            let r = await checker.check(pw, inputs: inputs)
            XCTAssertFalse(r.ok, "\(pw) com \(inputs): \(r.hint)")
        }
        // Um caractere que vira muitos na NFKC continua curto, e invisível no meio não disfarça a senha.
        for pw in ["\u{FDFA}", "\u{FDFA}12345", "123\u{200B}456", "s\u{200B}enha123", "sen\u{00AD}ha123", "s\u{2800}enha123", "s\u{0332}enha123", "sênha123"] {
            let r = await checker.check(pw, inputs: [])
            XCTAssertFalse(r.ok, "\(pw.unicodeScalars.map { String($0.value, radix: 16) }): \(r.hint)")
        }
        // Base fraca repetida, com a última cópia cortada, curta ou além dos 64 caracteres que o zxcvbn mede.
        let repeated: [String] = ["qwertyuiopasdfghjklzxcvbnm", "qwertyuiopasdfghjklzxcvbnm1234567890", "senha123s3nha", "senha123" + String(repeating: "!", count: 66), "Senha123senha123SENHA123", "iloveyou1iloveyou2iloveyou3", "senha123321ahnes", "senha123senha123!", "iloveyou1iloveyou1ilo", String(String(repeating: "futebol10", count: 8).prefix(65)), String(String(repeating: "brasil2026", count: 9).prefix(81))]
        for pw in repeated {
            let r = await checker.check(pw, inputs: [])
            XCTAssertFalse(r.ok, "\(pw): \(r.hint)")
        }
        let longPhrase = await checker.check("o vento leva a areia da praia para longe enquanto a lua cheia sobe devagar no ceu de verao", inputs: ["Ana Ribeiro", "ana"])
        XCTAssertTrue(longPhrase.ok, longPhrase.hint)
        // Frases boas com pedaço do nome dentro continuam passando.
        let fine: [(String, [String])] = [
            ("ana adora gatos pretos", ["Ana Zanchetta", "ana@shalomail.com"]),
            ("bananasplit9", ["Ana Ribeiro", "ana@shalomail.com"]),
            ("comprei-sofa-27", ["Ana Ribeiro", "ana@shalomail.com"]),
            ("coração de estudante 1985", ["Lia Moraes", "lia"]),
            ("p8Bia!zQ2", ["Bia Souza", "bia"]),           // nome curto com resto aleatório
            ("minha-cabana-no-lago-azul", ["Ana", "ana@shalomail.com"]),
            ("k9#Qm2!vk9#Qm2!v", []),                      // bloco aleatório digitado duas vezes
            ("cabanaverde77", ["Ana Ribeiro", "ana@shalomail.com"]),
            ("casa 8841 vermelha casa", ["Ana Ribeiro", "ana@shalomail.com"]),  // começa e termina igual, não é repetição
            ("gato4821gato9375gato1640", []),                   // números aleatórios em cada cópia
            ("casa_montanha_casa", ["Ana Ribeiro", "ana@shalomail.com"]),
        ]
        for (pw, inputs) in fine {
            let r = await checker.check(pw, inputs: inputs)
            XCTAssertTrue(r.ok, "\(pw) com \(inputs): \(r.hint)")
        }
        let short = await checker.check("abc", inputs: [])
        XCTAssertEqual(short.hint, "pw.min")
        let easy = await checker.check("senha123", inputs: [])
        XCTAssertEqual(easy.hint, "pw.weak")
    }
}
