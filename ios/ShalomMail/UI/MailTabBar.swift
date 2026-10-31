// Barra de baixo da caixa: Favoritos e Enviados de um lado, Spam e Escrever do outro, e a Entrada no meio,
// num círculo de cor chapada que sobe um pouco acima da barra. As outras pastas ficam no menu de cima. A
// barra é de vidro líquido no iOS 26; antes, material translúcido.
import SwiftUI

struct MailTabBar: View {
    @ObservedObject var model: MailboxModel
    let compose: () -> Void

    private static let height: CGFloat = 64
    private static let circle: CGFloat = 62
    // Quanto o círculo passa da borda de cima da barra.
    private static let lift: CGFloat = 20
    // O círculo fora da Entrada: chapado, um tom acima da barra.
    private static let idle = Color(light: 0xe8e8eb, dark: 0x2c2c30)

    var body: some View {
        ZStack(alignment: .bottom) {
            bar
            inbox.padding(.bottom, Self.height + Self.lift - Self.circle)
        }
        .padding(.horizontal, 16)
        .sensoryFeedback(.selection, trigger: model.folder)
    }

    private var bar: some View {
        HStack(spacing: 0) {
            tab(.starred)
            tab(.sent)
            Color.clear.frame(width: Self.circle + 12)
            tab(.spam)
            Button(action: compose) { item("square.and.pencil", t("mailbox.compose"), on: false) }
                .buttonStyle(.plain)
                .accessibilityLabel(t("mailbox.compose"))
        }
        .padding(.horizontal, 6)
        .frame(height: Self.height)
        .barGlass()
    }

    private var inbox: some View {
        let on = model.folder == .inbox
        let unread = model.counts["inbox"] ?? 0
        return Button { model.open(.inbox) } label: {
            Image(systemName: "tray")
                .symbolVariant(on ? .fill : .none)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(on ? Palette.accentOn : Palette.text)
                .frame(width: Self.circle, height: Self.circle)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .background(on ? Palette.accent : Self.idle, in: Circle())
        .shadow(color: .black.opacity(0.14), radius: 8, y: 3)
        .overlay(alignment: .topTrailing) {
            if unread > 0 {
                Text(unread > 99 ? "99+" : "\(unread)")
                    .font(.system(size: 11, weight: .bold)).monospacedDigit()
                    .foregroundStyle(Palette.bg)
                    .padding(.horizontal, 5).frame(minWidth: 19, minHeight: 19)
                    .background(Palette.text, in: Capsule())
                    .overlay(Capsule().stroke(Palette.bg, lineWidth: 2))
                    .offset(x: 2, y: -2)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityLabel(Folder.inbox.title)
        .accessibilityValue(unread > 0 ? "\(unread)" : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func tab(_ f: Folder) -> some View {
        Button { model.open(f) } label: { item(f.icon, f.title, on: model.folder == f) }
            .buttonStyle(.plain)
            .accessibilityLabel(f.title)
            .accessibilityAddTraits(model.folder == f ? .isSelected : [])
    }

    private func item(_ icon: String, _ title: String, on: Bool) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon)
                .symbolVariant(on ? .fill : .none)
                .font(.system(size: 19, weight: on ? .semibold : .regular))
                .frame(height: 24)
            Text(title)
                .font(.system(size: 10, weight: on ? .semibold : .medium))
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .foregroundStyle(on ? Palette.text : Palette.text2)
        .frame(maxWidth: .infinity, minHeight: Self.height)
        .contentShape(Rectangle())
    }
}

private extension View {
    @ViewBuilder func barGlass() -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.interactive(), in: Capsule())
        } else {
            background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Palette.line, lineWidth: 0.5))
                .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
        }
    }
}
