// Escrever: Para, Cc e Cco com sugestões feitas neste iPhone, assunto, texto e anexos. O rascunho é guardado
// lacrado com a própria chave enquanto se escreve. Cada destinatário mostra se vai fechado de ponta a ponta
// (conta Shalom) ou como e-mail comum. Se a chave de um contato mudou, o envio para e mostra as impressões.
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ComposeSeed {
    var to: [Person] = []
    var cc: [Person] = []
    var subject = ""
    var text = ""
    var quoted: (header: String, html: String)?
    var inReplyTo: String?
    var references: String?
    var attachments: [OutgoingAttachment] = []
    var kind: Kind = .new
    // Rascunho reaberto: a versão nova substitui esta, e some quando a mensagem sai.
    var draftId: String?
    var bcc: [Person] = []
    enum Kind { case new, reply, forward }
}

@MainActor
final class ComposerModel: ObservableObject {
    @Published var to: [Person]
    @Published var cc: [Person]
    @Published var bcc: [Person] = []
    @Published var subject: String
    @Published var text: String
    @Published var attachments: [OutgoingAttachment]
    @Published var showCc: Bool
    @Published var sending = false
    @Published var error: String?
    @Published var keyChange: (address: String, before: String, after: String, newKey: String)?
    @Published var draftNote = false
    @Published var kinds: [String: Bool?] = [:]

    let seed: ComposeSeed
    let session: Session
    private var draftId: String?
    private var saveTask: Task<Void, Never>?

    init(seed: ComposeSeed, session: Session) {
        self.seed = seed
        self.session = session
        to = seed.to; cc = seed.cc; bcc = seed.bcc; subject = seed.subject; text = seed.text; attachments = seed.attachments
        draftId = seed.draftId
        showCc = !seed.cc.isEmpty || !seed.bcc.isEmpty
    }

    var recipients: [Person] { to + cc + bcc }
    var allSealed: Bool { !recipients.isEmpty && recipients.allSatisfy { Outbox.isShalom($0.address) } }
    var total: Int { attachments.reduce(0) { $0 + $1.content.count } }

    func outgoing() -> Outgoing {
        Outgoing(to: to, cc: cc, bcc: bcc, subject: subject, text: text, quoted: seed.quoted, inReplyTo: seed.inReplyTo, references: seed.references, attachments: attachments)
    }

    // Conta Shalom existe? (pergunta sem cookie). nil = conferindo, false = não existe.
    func check(_ p: Person) {
        let a = p.address.lowercased()
        guard Outbox.isShalom(a), kinds[a] == nil else { return }
        kinds[a] = .some(nil)
        Task { kinds[a] = .some(((try? await Outbox.shared.publicKey(of: a)) ?? nil) != nil) }
    }

    // Guarda o rascunho 2 segundos depois da última mudança.
    func changed() {
        saveTask?.cancel()
        guard !text.isEmpty || !subject.isEmpty || !recipients.isEmpty, total <= ImagePrep.maxTotal else { return }
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            if let id = try? await Outbox.shared.saveDraft(outgoing(), replace: draftId, session: session) {
                draftId = id
                draftNote = true
            }
        }
    }

    func send() async -> Bool {
        guard !recipients.isEmpty else { error = t("composer.needRecipient"); return false }
        if let bad = recipients.first(where: { !$0.address.contains("@") }) { error = t("composer.invalidAddr", ["address": bad.address]); return false }
        if let missing = recipients.first(where: { kinds[$0.address.lowercased()] == .some(false) }) { error = t("composer.noAccountWith", ["address": missing.address]); return false }
        guard attachments.count <= 30 else { error = t("composer.tooMany", ["max": 30]); return false }
        guard total <= ImagePrep.maxTotal else { error = t("composer.tooBig", ["max": "3,5 MB"]); return false }
        saveTask?.cancel()
        sending = true
        error = nil
        defer { sending = false }
        do {
            try await Outbox.shared.send(outgoing(), session: session)
            if let draftId { await Outbox.shared.deleteDraft(draftId) }
            return true
        } catch ComposeError.keyChanged(let address, let before, let after, let newKey) {
            keyChange = (address, before, after, newKey)
        } catch {
            self.error = error.localizedDescription
        }
        return false
    }

    func trustNewKey() async -> Bool {
        guard let k = keyChange else { return false }
        await Pins.shared.trustNew(session.user.id, k.address, k.newKey)
        keyChange = nil
        return await send()
    }

    func discard() async {
        saveTask?.cancel()
        if let draftId { await Outbox.shared.deleteDraft(draftId) }
    }

    func add(_ data: Data, filename: String, type: String) {
        attachments.append(ImagePrep.prepare(data, filename: filename, type: type))
        changed()
    }
}

struct ComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ComposerModel
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingFile = false
    @State private var askDiscard = false
    let onSent: (Bool) -> Void

    init(seed: ComposeSeed, session: Session, onSent: @escaping (Bool) -> Void) {
        _model = StateObject(wrappedValue: ComposerModel(seed: seed, session: session))
        self.onSent = onSent
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    RecipientField(label: t("composer.to"), people: $model.to, model: model, trailing: model.showCc ? nil : AnyView(Button(t("composer.ccBcc")) { model.showCc = true }.font(.system(size: 14)).foregroundStyle(Palette.text3)))
                    Divider().overlay(Palette.line)
                    if model.showCc {
                        RecipientField(label: t("composer.cc"), people: $model.cc, model: model)
                        Divider().overlay(Palette.line)
                        RecipientField(label: t("composer.bcc"), people: $model.bcc, model: model)
                        Divider().overlay(Palette.line)
                    }
                    TextField(t("composer.subject"), text: $model.subject)
                        .font(.system(size: 16, weight: .medium)).padding(.horizontal, 16).frame(minHeight: 48)
                        .onChange(of: model.subject) { _, _ in model.changed() }
                    Divider().overlay(Palette.line)
                    TextEditor(text: $model.text)
                        .font(.system(size: 16)).scrollContentBackground(.hidden).frame(minHeight: 220).padding(.horizontal, 11).padding(.top, 6)
                        .overlay(alignment: .topLeading) {
                            if model.text.isEmpty {
                                Text(t(model.seed.kind == .reply ? "composer.replyPlaceholder" : model.seed.kind == .forward ? "composer.fwdPlaceholder" : "composer.newPlaceholder"))
                                    .font(.system(size: 16)).foregroundStyle(Palette.text3).padding(.horizontal, 16).padding(.top, 14).allowsHitTesting(false)
                            }
                        }
                        .onChange(of: model.text) { _, _ in model.changed() }
                    if model.seed.quoted != nil {
                        Label(t(model.seed.kind == .forward ? "composer.quotedFwd" : "composer.quotedPrev"), systemImage: "text.quote")
                            .font(.system(size: 13)).foregroundStyle(Palette.text3).frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    }
                    if !model.attachments.isEmpty { attachmentList }
                    status.padding(16)
                }
            }
            .background(Palette.bg)
            .navigationTitle(t(model.seed.kind == .new ? "mailbox.newMessage" : model.seed.kind == .reply ? "mailbox.reply" : "mailbox.forward"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { if model.text.isEmpty && model.recipients.isEmpty && model.subject.isEmpty { dismiss() } else { askDiscard = true } }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    PhotosPicker(selection: $photos, maxSelectionCount: 10, matching: .images) { Image(systemName: "photo") }
                        .accessibilityLabel(t("composer.attach"))
                    Button { pickingFile = true } label: { Image(systemName: "paperclip") }.accessibilityLabel(t("composer.attach"))
                    Spacer()
                    if model.draftNote { Text(t("composer.draftSaved")).font(.system(size: 12)).foregroundStyle(Palette.text3) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { if await model.send() { onSent(model.allSealed); dismiss() } }
                    } label: {
                        if model.sending { ProgressView() } else { Image(systemName: "paperplane.fill") }
                    }
                    .disabled(model.sending || model.recipients.isEmpty)
                    .accessibilityLabel(t("composer.send"))
                }
            }
            .confirmationDialog(t("composer.discardAsk"), isPresented: $askDiscard, titleVisibility: .visible) {
                Button(t("composer.discard"), role: .destructive) { Task { await model.discard(); dismiss() } }
                Button(t("ios.keepDraft")) { dismiss() }
                Button(t("composer.keepWriting"), role: .cancel) {}
            }
            .alert(model.keyChange.map { t("composer.keyTitle", ["address": $0.address]) } ?? "", isPresented: Binding(get: { model.keyChange != nil }, set: { if !$0 { model.keyChange = nil } })) {
                Button(t("composer.trust")) { Task { if await model.trustNewKey() { onSent(model.allSealed); dismiss() } } }
                Button(t("composer.dontSend"), role: .cancel) { model.keyChange = nil }
            } message: {
                if let k = model.keyChange { Text("\(t("composer.before")): \(k.before)\n\(t("composer.now")): \(k.after)") }
            }
            .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                guard case .success(let urls) = result else { return }
                for url in urls {
                    let ok = url.startAccessingSecurityScopedResource()
                    defer { if ok { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url) {
                        model.add(data, filename: url.lastPathComponent, type: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
                    }
                }
            }
            .onChange(of: photos) { _, items in
                for item in items {
                    Task {
                        if let data = try? await item.loadTransferable(type: Data.self) {
                            let type = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
                            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                            model.add(data, filename: "foto.\(ext)", type: type)
                        }
                    }
                }
                photos = []
            }
        }
        .interactiveDismissDisabled(model.sending)
    }

    private var attachmentList: some View {
        VStack(spacing: 8) {
            ForEach(model.attachments) { a in
                HStack(spacing: 10) {
                    Image(systemName: a.type.hasPrefix("image/") ? "photo" : "doc").foregroundStyle(Palette.text2)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(a.filename).font(.system(size: 14, weight: .medium)).lineLimit(1)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(a.content.count), countStyle: .file)).font(.system(size: 12)).foregroundStyle(Palette.text3)
                    }
                    Spacer()
                    Button { model.attachments.removeAll { $0.id == a.id }; model.changed() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.text3) }
                        .accessibilityLabel(t("composer.removeAttach", ["name": a.filename]))
                }
                .padding(.horizontal, 12).frame(height: 52)
                .background(Palette.fill1, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder private var status: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.error { Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading) }
            if !model.recipients.isEmpty {
                Label(t(model.allSealed ? "composer.sealed" : model.recipients.allSatisfy({ !Outbox.isShalom($0.address) }) ? "composer.allPlain" : "composer.chip.plain"),
                      systemImage: model.allSealed ? "lock.fill" : "envelope")
                    .font(.system(size: 13)).foregroundStyle(model.allSealed ? Palette.safe : Palette.text3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Destinatários em fichas. Vírgula, espaço ou Enter fecha a ficha; as sugestões saem deste iPhone.
struct RecipientField: View {
    let label: String
    @Binding var people: [Person]
    @ObservedObject var model: ComposerModel
    var trailing: AnyView? = nil
    @State private var input = ""
    @FocusState private var focused: Bool

    private var suggestions: [Person] {
        let q = input.trimmingCharacters(in: .whitespaces).lowercased()
        guard q.count >= 1 else { return [] }
        let fold = { (s: String) in s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil) }
        let fq = fold(q)
        return Mailbox.shared.contacts(me: model.session.user.address)
            .filter { p in !model.recipients.contains { $0.address == p.address } && (fold(p.address).hasPrefix(fq) || fold(p.name).split(separator: " ").contains { $0.hasPrefix(fq) }) }
            .prefix(5).map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(label).font(.system(size: 15)).foregroundStyle(Palette.text3).frame(minWidth: 34, alignment: .leading)
                FlowChips(people: people, kinds: model.kinds) { p in people.removeAll { $0 == p }; model.changed() } field: {
                    TextField("", text: $input)
                        .font(.system(size: 16)).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focused).submitLabel(.next).onSubmit(commit)
                        .onChange(of: input) { _, v in if v.hasSuffix(",") || v.hasSuffix(" ") || v.hasSuffix(";") { commit() } }
                        .onChange(of: focused) { _, f in if !f { commit() } }
                        .frame(minWidth: 60)
                }
                if let trailing { trailing }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            if focused && !suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(suggestions, id: \.address) { p in
                        Button { input = ""; people.append(p); model.check(p); model.changed() } label: {
                            HStack(spacing: 10) {
                                Avatar(name: p.name, address: p.address, size: 28)
                                VStack(alignment: .leading, spacing: 0) {
                                    if !p.name.isEmpty { Text(p.name).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.text) }
                                    Text(p.address).font(.system(size: 13)).foregroundStyle(Palette.text3)
                                }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    Text(t("composer.sugNote")).font(.system(size: 11.5)).foregroundStyle(Palette.text3).padding(.horizontal, 16).padding(.vertical, 6)
                }
            }
        }
    }

    private func commit() {
        let parts = input.split(whereSeparator: { ",; ".contains($0) }).map { String($0).trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        input = ""
        for a in parts where !people.contains(where: { $0.address == a }) {
            let p = Person(name: "", address: a.contains("@") ? a : "\(a)@\(AppModel.domain)")
            people.append(p)
            model.check(p)
        }
        if !parts.isEmpty { model.changed() }
    }
}

// Fichas que quebram linha, com o campo de digitar no fim.
struct FlowChips<Field: View>: View {
    let people: [Person]
    let kinds: [String: Bool?]
    let remove: (Person) -> Void
    @ViewBuilder let field: Field

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(people, id: \.address) { p in
                let shalom = Outbox.isShalom(p.address)
                let missing = kinds[p.address.lowercased()] == .some(false)
                Button { remove(p) } label: {
                    HStack(spacing: 4) {
                        if shalom && !missing { Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(Palette.safe) }
                        if missing { Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(Palette.warn) }
                        Text(p.name.isEmpty ? p.address : p.name).font(.system(size: 14)).foregroundStyle(Palette.text).lineLimit(1)
                    }
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(Palette.fill2, in: Capsule())
                }
                .accessibilityLabel(t("composer.removeChip", ["address": p.address]))
            }
            field
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 300
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > width, x > 0 { x = 0; y += row + spacing; row = 0 }
            x += min(s.width, width) + spacing; row = max(row, s.height)
        }
        return CGSize(width: width, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += row + spacing; row = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(s.width, bounds.width), height: s.height))
            x += min(s.width, bounds.width) + spacing; row = max(row, s.height)
        }
    }
}
