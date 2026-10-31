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
        .sheet(item: $app.link) { link in
            switch link {
            case .reset(let token): ResetPasswordView(token: token).environmentObject(app)
            case .connect(let code): ConnectCliView(code: code)
            case .confirm: EmptyView()
            }
        }
    }
}
