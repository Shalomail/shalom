// Capa do seletor de apps: a miniatura mostra só o logo. Fica numa janela própria, acima de tudo (folhas,
// alertas, a confirmação de senha), porque a escrita, as Configurações e os códigos de recuperação abrem em
// folha e passavam por cima de uma capa posta na tela de baixo.
import SwiftUI
import UIKit

@MainActor
enum Cover {
    private static var window: UIWindow?

    static func show(_ shown: Bool, light: Bool = false) {
        if !shown { window?.isHidden = true; window = nil; return }
        guard window == nil, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let w = UIWindow(windowScene: scene)
        let host = UIHostingController(rootView: ZStack { Palette.bg.ignoresSafeArea(); Logo(size: 56) }.preferredColorScheme(light ? .light : AppTheme.current.scheme))
        host.view.backgroundColor = .clear
        w.rootViewController = host
        w.windowLevel = .alert + 1
        w.isHidden = false
        window = w
    }
}
