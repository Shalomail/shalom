import SwiftUI

struct RootView: View {
    @EnvironmentObject var app: AppModel

    var body: some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            switch app.phase {
            case .starting: Logo(size: 44)
            case .signedOut: SignInView()
            case .locked(let user): UnlockView(user: user)
            case .open(let session):
                if app.needsRecovery { RecoveryPromptView(session: session) } else { MailboxView(session: session).id(session.user.id) }
            }
        }
        .task { await app.start() }
        .onOpenURL { app.handle($0) }
        // Conectar o terminal só com a caixa aberta: com o app trancado (Face ID, PIN, inatividade) o pedido
        // espera o desbloqueio. A senha nova abre em qualquer estado (é para quem não consegue entrar).
        .sheet(item: Binding(get: {
            if case .connect = app.link, !app.isOpen { return nil }
            return app.link
        }, set: { app.link = $0 })) { link in
            switch link {
            case .reset(let token): ResetPasswordView(token: token).environmentObject(app)
            case .connect(let code): ConnectCliView(code: code)
            case .confirm: EmptyView()
            }
        }
    }
}
