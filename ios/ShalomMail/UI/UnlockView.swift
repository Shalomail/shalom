// Conta guardada neste iPhone: a chave abre com Face ID (ou o código do iPhone). Abre sozinho ao aparecer.
import SwiftUI

struct UnlockView: View {
    @EnvironmentObject var app: AppModel
    let user: User
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Logo(size: 64).padding(.bottom, 32)
            Text(t("ios.locked")).font(.system(size: 26, weight: .semibold)).tracking(-0.5).foregroundStyle(Palette.text)
            Text(user.address).font(.system(size: 15)).foregroundStyle(Palette.text2).padding(.top, 6)
            Text(t("ios.lockedText")).font(.system(size: 14)).foregroundStyle(Palette.text3).multilineTextAlignment(.center).frame(maxWidth: 300).padding(.top, 14)
            PrimaryButton(title: t("ios.unlock"), busy: busy, action: unlock)
                .padding(.top, 28)
            if let error { Note(text: error, tone: .warn).padding(.top, 14) }
            Spacer()
            QuietButton(title: t("ios.signOutHere")) { Task { await app.signOut() } }.padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .task { unlock() }
    }

    private func unlock() {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { try await app.unlock(user) } catch VaultError.cancelled { } catch { self.error = error.localizedDescription }
        }
    }
}
