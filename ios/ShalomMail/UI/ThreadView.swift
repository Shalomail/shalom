// A conversa: cada mensagem com quem enviou (conferido no aparelho quando é Shalom para Shalom), a hora e o
// corpo aberto com a chave deste iPhone. A mais recente vem aberta; as outras abrem com um toque.
import SwiftUI

struct ThreadView: View {
    let thread: Thread
    let session: Session
    let folder: Folder
    @ObservedObject var model: MailboxModel
    let close: () -> Void
    @State private var open: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(thread.latest.h.subject.isEmpty ? t("common.noSubject") : thread.latest.h.subject)
                    .font(.system(size: 22, weight: .semibold)).tracking(-0.4).foregroundStyle(Palette.text)
                    .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
                ForEach(thread.items) { item in
                    MessageCard(item: item, session: session, expanded: open.contains(item.id) || item.id == thread.latest.id, toggle: {
                        if open.contains(item.id) { open.remove(item.id) } else { open.insert(item.id) }
                    }, compose: { seed in model.composeSeed = seed })
                    Divider().overlay(Palette.line).padding(.leading, 16)
                }
            }
        }
        .background(Palette.bg)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                if folder != .drafts {
                    let target = model.archiveTarget
                    Button { model.move(thread, to: target.folder, text: target.text); close() } label: { Image(systemName: target.icon) }.accessibilityLabel(target.label)
                }
                Spacer()
                if folder == .trash {
                    Button(role: .destructive) { model.deleteForever(thread); close() } label: { Image(systemName: "trash.slash") }.accessibilityLabel(t("mailbox.deleteForever"))
                } else {
                    Button { model.move(thread, to: "trash", text: t("mailbox.moved.trash")); close() } label: { Image(systemName: "trash") }.accessibilityLabel(t("reader.trash"))
                }
                Spacer()
                Menu {
                    Button { model.toggleStar(thread) } label: { Label(t(thread.starred ? "mailbox.unstar" : "mailbox.star"), systemImage: thread.starred ? "star.slash" : "star") }
                    Button { model.togglePin(thread) } label: { Label(t(thread.pinned ? "mailbox.unpin" : "mailbox.pin"), systemImage: thread.pinned ? "pin.slash" : "pin") }
                    Button { model.setSeen(thread, false); close() } label: { Label(t("mailbox.markUnread"), systemImage: "envelope.badge") }
                    if folder != .spam && folder != .sent && folder != .drafts {
                        Button(role: .destructive) { model.move(thread, to: "spam", text: t("mailbox.moved.spam")); close() } label: { Label(t("reader.markSpam"), systemImage: "xmark.shield") }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
    }
}

// Resposta e encaminhamento, como o web: para quem responder, "Re:", o fio e a citação.
enum Reply {
    static func quote(_ item: Item, _ email: ParsedEmail, header key: String) -> (header: String, html: String) {
        let from = item.h.from.map { "\($0.name.isEmpty ? $0.address : $0.name) <\($0.address)>" } ?? t("common.someone")
        let html = email.html ?? MIMEBuilder.esc(email.text ?? "").replacingOccurrences(of: "\n", with: "<br>")
        return (t(key, ["date": fullTime(item.date), "from": from]), html)
    }

    static func seed(_ kind: ComposeSeed.Kind, all: Bool = false, item: Item, email: ParsedEmail, me: String) -> ComposeSeed {
        let subject = Mailbox.cleanSubject(item.h.subject)
        if kind == .forward {
            return ComposeSeed(subject: "\(t("mailbox.fwdPrefix")): \(subject)", quoted: quote(item, email, header: "mailbox.fwdHeader"),
                               attachments: email.files.map { OutgoingAttachment(filename: $0.filename, type: $0.mimeType, content: $0.data) }, kind: .forward)
        }
        let sender = email.replyTo.isEmpty ? (email.from.map { [$0] } ?? []) : email.replyTo
        let to = item.folder == "sent" ? email.to : sender
        let extra = all ? email.to.filter { p in p.address != me && !to.contains { $0.address == p.address } } : []
        let cc = all ? email.cc.filter { $0.address != me } : []
        return ComposeSeed(to: (to + extra).filter { $0.address != me || item.folder == "sent" }, cc: cc, subject: "\(t("mailbox.rePrefix")): \(subject)",
                           quoted: quote(item, email, header: "mailbox.quoteHeader"), inReplyTo: email.messageId,
                           references: [email.references, email.messageId].compactMap { $0 }.joined(separator: " "), kind: .reply)
    }
}

struct MessageCard: View {
    @Environment(\.colorScheme) private var scheme
    let item: Item
    let session: Session
    let expanded: Bool
    let toggle: () -> Void
    let compose: (ComposeSeed) -> Void

    @State private var email: ParsedEmail?
    @State private var error: String?
    @State private var showImages = false
    @State private var proxied: String?
    @State private var height: CGFloat = 80
    @State private var identity = false

    private var from: Person? { item.h.from }
    private var name: String { from.map { $0.name.isEmpty ? $0.address : $0.name } ?? "?" }
    private var isSpam: Bool { item.folder == "spam" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: toggle) { header }.buttonStyle(.plain)
            if expanded {
                badges
                content
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .task(id: expanded) { if expanded && email == nil { await load() } }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(name: from?.name ?? "", address: from?.address ?? "?", size: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
                    if item.sealedEnd { Image(systemName: "checkmark.seal.fill").font(.system(size: 12)).foregroundStyle(Palette.safe) }
                    Spacer(minLength: 4)
                    Text(listTime(item.date)).font(.system(size: 12)).foregroundStyle(Palette.text3)
                }
                if expanded {
                    Text(from?.address ?? "").font(.system(size: 13)).foregroundStyle(Palette.text3).lineLimit(1)
                    if !item.h.to.isEmpty {
                        Text("\(t("reader.to")): \(item.h.to.map { $0.name.isEmpty ? $0.address : $0.name }.joined(separator: ", "))")
                            .font(.system(size: 13)).foregroundStyle(Palette.text3).lineLimit(2)
                    }
                } else {
                    Text(item.h.snippet).font(.system(size: 13)).foregroundStyle(Palette.text3).lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder private var badges: some View {
        if item.keyChanged {
            Note(text: t("reader.keyTitle", ["address": item.h.from?.address ?? ""]), tone: .warn).frame(maxWidth: .infinity, alignment: .leading)
        } else if item.spoofed {
            Note(text: t("reader.spoofTitle"), tone: .warn).frame(maxWidth: .infinity, alignment: .leading)
        } else if item.sealedEnd {
            HStack(spacing: 10) {
                Label(item.own || item.folder == "sent" ? t("reader.lockedHere") : t("reader.lockedThere", ["name": name]), systemImage: "lock.fill").font(.system(size: 12.5)).foregroundStyle(Palette.safe)
                Spacer(minLength: 4)
                if item.senderKey != nil { Button(t("reader.idCheck")) { identity = true }.font(.system(size: 12.5, weight: .semibold)) }
            }
            .sheet(isPresented: $identity) {
                if let key = item.senderKey, let address = item.sender { IdentitySheet(name: name, address: address, publicKey: key, userId: session.user.id) }
            }
        }
        if isSpam { Note(text: t("reader.spam"), tone: .warn).frame(maxWidth: .infinity, alignment: .leading) }
    }

    @ViewBuilder private var content: some View {
        if let email {
            if let html = email.html, !html.isEmpty {
                if BodyHTML.remoteImages(html) && !isSpam && !showImages {
                    HStack(spacing: 10) {
                        Text(t("ios.imagesBlocked")).font(.system(size: 12.5)).foregroundStyle(Palette.text3)
                        Spacer(minLength: 6)
                        Button(t("ios.showImages")) {
                            showImages = true
                            Task { proxied = await BodyHTML.proxyImages(html) }
                        }.font(.system(size: 13, weight: .semibold))
                    }
                }
                HTMLBody(html: BodyHTML.document(email, html: proxied, dark: scheme == .dark), allowRemote: false, linksOn: !isSpam && !item.spoofed, height: $height)
                    .frame(height: max(height, 40))
            } else {
                PlainBody(text: email.text ?? "", linksOn: !isSpam && !item.spoofed)
            }
            if !email.files.isEmpty { AttachmentsView(files: email.files) }
            if item.folder != "drafts" {
                HStack(spacing: 8) {
                    replyButton(t("mailbox.reply"), "arrowshape.turn.up.left") { compose(Reply.seed(.reply, item: item, email: email, me: session.user.address)) }
                    replyButton(t("mailbox.replyAll"), "arrowshape.turn.up.left.2") { compose(Reply.seed(.reply, all: true, item: item, email: email, me: session.user.address)) }
                    replyButton(t("mailbox.forward"), "arrowshape.turn.up.right") { compose(Reply.seed(.forward, item: item, email: email, me: session.user.address)) }
                }
                .padding(.top, 4)
            }
        } else if let error {
            Note(text: error, tone: .warn).frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 8) { ProgressView(); Text(t("reader.opening")).font(.system(size: 13)).foregroundStyle(Palette.text3) }
        }
    }

    private func replyButton(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(.system(size: 13, weight: .medium)).lineLimit(1).foregroundStyle(Palette.text)
                .padding(.horizontal, 12).frame(height: 34)
                .background(Palette.fill2, in: Capsule())
        }
    }

    private func load() async {
        do { email = try await Mailbox.shared.read(item, session: session) } catch { self.error = error.localizedDescription }
    }
}

struct AttachmentsView: View {
    let files: [Attachment]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(files) { a in
                    if let url = temp(a) {
                        ShareLink(item: url) {
                            HStack(spacing: 8) {
                                Image(systemName: icon(a)).font(.system(size: 15)).foregroundStyle(Palette.text2)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(a.filename).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(a.data.count), countStyle: .file)).font(.system(size: 11.5)).foregroundStyle(Palette.text3)
                                }
                            }
                            .padding(.horizontal, 12).frame(height: 48)
                            .background(Palette.fill1, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
            }
        }
    }

    private func icon(_ a: Attachment) -> String {
        a.mimeType.hasPrefix("image/") ? "photo" : a.mimeType == "application/pdf" ? "doc.richtext" : "doc"
    }

    // O anexo vai para um arquivo temporário só na hora de compartilhar (o iOS apaga a pasta tmp).
    private func temp(_ a: Attachment) -> URL? {
        let safe = a.filename.replacingOccurrences(of: "/", with: "_")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(a.id.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(safe.isEmpty ? "attachment" : safe)
        if !FileManager.default.fileExists(atPath: url.path) { try? a.data.write(to: url, options: .completeFileProtection) }
        return url
    }
}
