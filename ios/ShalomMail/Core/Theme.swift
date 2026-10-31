// Cores do app web (web/src/styles.css): escuro por padrão, claro opcional. Cor só para estado: verde
// para ponta a ponta e conferido, âmbar para alerta.
import SwiftUI
import UIKit

extension Color {
    init(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) {
        self = Color(UIColor { trait in
            let (hex, a) = trait.userInterfaceStyle == .dark ? (dark, darkAlpha) : (light, lightAlpha)
            return UIColor(red: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
        })
    }
}

enum Palette {
    static let bg = Color(light: 0xffffff, dark: 0x000000)
    static let surface = Color(light: 0xffffff, dark: 0x0c0c0e)
    static let text = Color(light: 0x0a0a0a, dark: 0xf5f5f7)
    static let text2 = Color(light: 0x4b4b50, dark: 0xaeaeb2)
    static let text3 = Color(light: 0x76767c, dark: 0x86868b)
    static let fill1 = Color(light: 0x000000, dark: 0xffffff, lightAlpha: 0.035, darkAlpha: 0.05)
    static let fill2 = Color(light: 0x000000, dark: 0xffffff, lightAlpha: 0.055, darkAlpha: 0.08)
    static let line = Color(light: 0x000000, dark: 0xffffff, lightAlpha: 0.12, darkAlpha: 0.12)
    static let accent = Color(light: 0x0a0a0a, dark: 0xffffff)
    static let accentOn = Color(light: 0xffffff, dark: 0x000000)
    static let safe = Color(light: 0x1d8a62, dark: 0x4cc395)
    static let warn = Color(light: 0x9a5b06, dark: 0xf0b45a)
}

// Tema escolhido (como o "shalom-theme" do web). Sem escolha: escuro.
enum AppTheme: String, CaseIterable {
    case dark, light
    static var current: AppTheme { AppTheme(rawValue: UserDefaults.standard.string(forKey: "shalom-theme") ?? "") ?? .dark }
    var scheme: ColorScheme { self == .dark ? .dark : .light }
}
