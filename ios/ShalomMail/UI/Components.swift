// Peças das telas, no desenho do app web: logo do avião de papel, avatar com iniciais, campo de 48 pt com a
// seta que vira botão quando dá para seguir, botão claro e nota de rodapé.
import SwiftUI

// O avião saindo do envelope (brand/shalom-mail-icone.svg), preenchido par-ímpar.
struct LogoMark: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 414, sy = rect.height / 306
        var p = Path()
        let shapes: [[(CGFloat, CGFloat)]] = [
            [(0, 0), (414, 0), (414, 306), (0, 306)],
            [(28, 28), (28, 263.5), (160.5, 159.5), (168.5, 189), (54, 278), (386, 278), (386, 57.5), (281.5, 244), (244.5, 188), (208, 234.5), (182, 142.5), (97, 93.5), (311, 28)],
            [(204.5, 122.5), (214, 150), (336, 54)],
        ]
        for s in shapes {
            p.move(to: CGPoint(x: rect.minX + s[0].0 * sx, y: rect.minY + s[0].1 * sy))
            for pt in s.dropFirst() { p.addLine(to: CGPoint(x: rect.minX + pt.0 * sx, y: rect.minY + pt.1 * sy)) }
            p.closeSubpath()
        }
        return p
    }
}

struct Logo: View {
    var size: CGFloat = 56
    var body: some View {
        LogoMark().fill(Palette.text, style: FillStyle(eoFill: true)).frame(width: size, height: size * 306 / 414)
            .accessibilityLabel("Shalom Mail")
    }
}

func initials(_ name: String, _ address: String) -> String {
    let words = name.split(separator: " ").filter { $0.first?.isLetter == true }
    if words.count >= 2 { return (String(words.first!.prefix(1)) + String(words.last!.prefix(1))).uppercased() }
    if let w = words.first { return String(w.prefix(2)).uppercased() }
    return String(address.prefix(1)).uppercased()
}

struct Avatar: View {
    let name: String
    let address: String
    var size: CGFloat = 40
    var body: some View {
        Text(initials(name, address))
            .font(.system(size: size * 0.38, weight: .semibold))
            .foregroundStyle(Palette.text2)
            .frame(width: size, height: size)
            .background(Palette.fill2, in: Circle())
            .accessibilityHidden(true)
    }
}

// Campo da tela de entrar: ícone à esquerda, o que se digita, e a seta à direita.
struct ArrowField<Content: View>: View {
    let icon: String
    let ready: Bool
    let busy: Bool
    let action: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text3).frame(width: 18)
            content.font(.system(size: 16)).foregroundStyle(Palette.text)
            Button(action: action) {
                Group {
                    if busy { ProgressView().tint(Palette.accentOn) } else { Image(systemName: "arrow.right").font(.system(size: 14, weight: .semibold)) }
                }
                .frame(width: 38, height: 38)
                .foregroundStyle(ready ? Palette.accentOn : Palette.text3)
                .background(ready ? Palette.accent : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .disabled(!ready || busy)
            .accessibilityLabel(t("common.continue"))
        }
        .padding(.leading, 14).padding(.trailing, 5)
        .frame(height: 48)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
        .frame(maxWidth: 304)
    }
}

struct Note: View {
    let text: String
    var tone: Tone = .plain
    enum Tone { case plain, warn, secure }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            if tone == .secure { Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(Palette.text) }
            if tone == .warn { Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)) }
            Text(text)
        }
        .font(.system(size: 13))
        .foregroundStyle(tone == .warn ? Palette.warn : Palette.text3)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 320)
    }
}

struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(Palette.accentOn) }
                Text(title).font(.system(size: 16, weight: .semibold))
            }
            .frame(maxWidth: 304, minHeight: 48)
            .foregroundStyle(Palette.accentOn)
            .background(Palette.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .disabled(busy)
    }
}

struct QuietButton: View {
    let title: String
    let action: () -> Void
    var body: some View {
        Button(title, action: action).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.text3)
    }
}

// Hora da lista: hoje mostra a hora; neste ano, dia e mês; antes, a data curta.
func listTime(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = L10n.shared.locale
    let cal = Calendar.current
    if cal.isDateInToday(date) { f.timeStyle = .short; f.dateStyle = .none }
    else if cal.isDate(date, equalTo: Date(), toGranularity: .year) { f.setLocalizedDateFormatFromTemplate("d MMM") }
    else { f.dateStyle = .short; f.timeStyle = .none }
    return f.string(from: date)
}

func fullTime(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = L10n.shared.locale
    f.dateStyle = .medium
    f.timeStyle = .short
    return f.string(from: date)
}
