// A caixa: pasta escolhida no título, conversas agrupadas como no web, puxar para atualizar, mais páginas ao
// chegar no fim e a caixa ao vivo (o servidor avisa quando muda algo).
import SwiftUI

@MainActor
final class MailboxModel: ObservableObject {
    @Published var folder: Folder = .inbox
    @Published var threads: [Thread] = []
    @Published var counts: Counts = [:] { didSet { Push.shared.badge(counts["inbox"] ?? 0) } }
    @Published var loading = true
    @Published var error: String?
    @Published var more = false

    let session: Session
    private var items: [Item] = []
    private var extra: [Item] = []
    private var loadingMore = false
    // A última lista de cada pasta nesta sessão, como no web: trocar de pasta mostra a guardada na hora e
    // atualiza por trás. Sem isso o primeiro quadro da pasta nova saía com o "vazio" dela, depois o
    // carregando, e só então a lista.
    private var cache: [Folder: (items: [Item], more: Bool)] = [:]
    private var prefetchRun = 0
    private var prefetched = false

    init(session: Session) { self.session = session }

    // A outra pasta que entra nas conversas: Enviados para a Entrada (e as outras), a Entrada para Enviados.
    private var extraFolder: Folder { folder == .sent ? .inbox : .sent }

    func refresh(quiet: Bool = false) async {
        let asked = folder
        if !quiet { loading = true }
        do {
            async let main = Mailbox.shared.list(asked, session: session)
            async let other = try? Mailbox.shared.list(extraFolder, session: session)
            let (m, o) = try await (main, other)
            guard asked == folder else { return }
            items = m.items; more = m.more; counts = m.counts
            extra = asked == .drafts ? [] : o?.items ?? []
            cache[asked] = (items, more)
            if let o { cache[extraFolder] = (o.items, o.more) }
            rebuild()
            error = nil
            if !prefetched { prefetched = true; prefetchOthers() }
        } catch {
            if !quiet && asked == folder { self.error = (error as? APIError)?.message ?? t("mailbox.loadFail") }
        }
        if asked == folder { loading = false }
    }

    func loadMore() async {
        guard more, !loadingMore, let last = items.last else { return }
        loadingMore = true
        defer { loadingMore = false }
        let asked = folder
        if let r = try? await Mailbox.shared.list(asked, before: last.receivedAt, session: session), asked == folder {
            let have = Set(items.map(\.id))
            items += r.items.filter { !have.contains($0.id) }
            more = r.more
            rebuild()
        }
    }

    func open(_ f: Folder) {
        guard f != folder else { return }
        let saved = cache[f]
        folder = f
        items = saved?.items ?? []
        extra = f == .drafts ? [] : cache[extraFolder]?.items ?? []
        more = saved?.more ?? false
        loading = saved == nil
        error = nil
        rebuild()
        Task { await refresh(quiet: saved != nil) }
    }

    // As outras pastas são carregadas por trás depois da primeira lista e de cada novidade da caixa ao vivo.
    func prefetchOthers() {
        prefetchRun += 1
        let run = prefetchRun
        Task {
            for f in [Folder.sent, .spam, .starred, .inbox, .drafts, .archive, .trash] {
                guard run == prefetchRun else { return }
                guard f != folder, let r = try? await Mailbox.shared.list(f, session: session), run == prefetchRun, f != folder else { continue }
                cache[f] = (r.items, r.more)
            }
        }
    }

    // O que muda aqui (mover, marcar, mais páginas) também fica guardado para a volta a esta pasta.
    private func rebuild() {
        threads = Mailbox.threads(items, extra: extra)
        if !loading { cache[folder] = (items, more) }
    }

    @Published var query = ""

    // Busca no aparelho, nos cabeçalhos já abertos (o servidor não consegue ler os e-mails).
    var visible: [Thread] {
        let q = query.trimmingCharacters(in: .whitespaces).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        guard !q.isEmpty else { return threads }
        let fold = { (s: String?) in (s ?? "").folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil) }
        return threads.filter { th in th.items.contains { i in [i.h.subject, i.h.snippet, i.h.from?.name, i.h.from?.address].contains { fold($0).contains(q) } } }
    }

    // Rascunho abre no editor, com o que a pessoa já tinha escrito.
    func openDraft(_ thread: Thread) {
        let item = thread.latest
        Task {
            guard let e = try? await Mailbox.shared.read(item, session: session) else { return }
            composeSeed = ComposeSeed(to: e.to, cc: e.cc, subject: e.subject, text: e.text ?? "", inReplyTo: e.inReplyTo, references: e.references,
                                      attachments: e.files.map { OutgoingAttachment(filename: $0.filename, type: $0.mimeType, content: $0.data) },
                                      draftId: item.id, bcc: MIME.header(e.headers, "bcc").map(MIME.addresses) ?? [])
        }
    }

    @Published var toast: String?
    @Published var composeSeed: ComposeSeed?

    func show(_ text: String) {
        toast = text
        Task { try? await Task.sleep(nanoseconds: 3_000_000_000); if toast == text { toast = nil } }
    }

    // Tira as conversas da lista na hora e avisa o servidor; se falhar, a lista volta pelo servidor.
    func move(_ thread: Thread, to target: String, text: String) {
        let ids = thread.inFolder.map(\.id)
        items.removeAll { ids.contains($0.id) }
        rebuild()
        show(text)
        Task {
            do { counts = try await Mailbox.shared.update(ids, folder: target) } catch { await refresh(quiet: true) }
        }
    }

    func deleteForever(_ thread: Thread) {
        let ids = thread.inFolder.map(\.id)
        items.removeAll { ids.contains($0.id) }
        rebuild()
        show(t("mailbox.deletedThread"))
        Task { do { try await Mailbox.shared.deleteForever(ids) } catch { await refresh(quiet: true) } }
    }

    func setSeen(_ thread: Thread, _ seen: Bool) {
        let ids = thread.inFolder.map(\.id)
        for i in items.indices where ids.contains(items[i].id) { items[i].seen = seen }
        rebuild()
        Task { if let c = try? await Mailbox.shared.update(ids, seen: seen) { counts = c } }
    }

    func toggleStar(_ thread: Thread) {
        let ids = thread.inFolder.map(\.id)
        let starred = !thread.starred
        if folder == .starred && !starred { items.removeAll { ids.contains($0.id) } } else { for i in items.indices where ids.contains(items[i].id) { items[i].starred = starred } }
        rebuild()
        Task { _ = try? await Mailbox.shared.update(ids, starred: starred) }
    }

    func togglePin(_ thread: Thread) {
        let ids = thread.inFolder.map(\.id)
        let pinned = !thread.pinned
        for i in items.indices where ids.contains(items[i].id) { items[i].pinned = pinned }
        rebuild()
        show(t(pinned ? "mailbox.pinned" : "mailbox.unpinned"))
        Task { _ = try? await Mailbox.shared.update(ids, pinned: pinned) }
    }

    // Para onde a conversa vai em cada pasta: arquivar (ou de volta à Entrada), lixeira (ou apagar de vez).
    var archiveTarget: (folder: String, label: String, text: String, icon: String) {
        switch folder {
        case .archive, .spam, .trash: return ("inbox", t(folder == .trash ? "mailbox.restore" : folder == .spam ? "mailbox.notSpam" : "mailbox.toInbox"), t(folder == .trash ? "mailbox.moved.restore" : "mailbox.moved.inbox"), "tray.and.arrow.down")
        default: return ("archive", t("mailbox.archive"), t("mailbox.moved.archive"), "archivebox")
        }
    }

    func markSeen(_ thread: Thread) {
        let ids = thread.inFolder.filter { !$0.seen }.map(\.id)
        guard !ids.isEmpty else { return }
        for i in items.indices where ids.contains(items[i].id) { items[i].seen = true }
        rebuild()
        Task { if let c = try? await Mailbox.shared.update(ids, seen: true) { counts = c } }
    }
}

struct MailboxView: View {
    @EnvironmentObject var app: AppModel
    @StateObject private var model: MailboxModel
    @State private var path: [String] = []
    @State private var settings = false

    init(session: Session) { _model = StateObject(wrappedValue: MailboxModel(session: session)) }

    var body: some View {
        NavigationStack(path: $path) {
            list
                .safeAreaInset(edge: .bottom, spacing: 0) { MailTabBar(model: model) { model.composeSeed = ComposeSeed() } }
                // Em cima, embaixo do título, desde a primeira tela: no iOS 26 a busca iria para baixo, empilhada sob
                // a barra das pastas.
                .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: t("mailbox.searchIn", ["folder": model.folder.title]))
                .navigationTitle(model.folder.title)
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { folderMenu }
                    ToolbarItem(placement: .topBarTrailing) { accountMenu }
                }
                .navigationDestination(for: String.self) { key in
                    if let thread = model.threads.first(where: { $0.key == key }) {
                        ThreadView(thread: thread, session: model.session, folder: model.folder, model: model, close: { path.removeAll() })
                            .onAppear { model.markSeen(thread) }
                    }
                }
        }
        .task {
            await model.refresh()
            Live.shared.start()
        }
        .onDisappear { Live.shared.stop() }
        .sheet(isPresented: Binding(get: { model.composeSeed != nil }, set: { if !$0 { model.composeSeed = nil } })) {
            if let seed = model.composeSeed {
                ComposerView(seed: seed, session: model.session) { sealed in
                    model.show(t(sealed ? "composer.sentSealed" : "composer.sent"))
                    Task { await model.refresh(quiet: true) }
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.accentOn)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Palette.accent, in: Capsule())
                    .padding(.bottom, 112)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.toast)
        .onReceive(NotificationCenter.default.publisher(for: .mailboxChanged)) { _ in
            Task { await model.refresh(quiet: true); model.prefetchOthers() }
        }
    }

    @ViewBuilder private var list: some View {
        if model.loading && model.threads.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = model.error, model.threads.isEmpty {
            VStack(spacing: 14) {
                Note(text: error, tone: .warn)
                QuietButton(title: t("ios.retry")) { Task { await model.refresh() } }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.threads.isEmpty {
            ScrollView {
                VStack(spacing: 10) {
                    Image(systemName: model.folder == .inbox ? "paperplane" : model.folder.icon).font(.system(size: 30, weight: .light)).foregroundStyle(Palette.text3)
                    Text(t("mailbox.empty.\(model.folder.rawValue)")).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.text2)
                    if model.folder == .inbox || model.folder == .spam {
                        Text(t("mailbox.hint.\(model.folder.rawValue)")).font(.system(size: 14)).foregroundStyle(Palette.text3).multilineTextAlignment(.center).frame(maxWidth: 280)
                    }
                }
                .frame(maxWidth: .infinity).padding(.top, 120)
            }
            .refreshable { await model.refresh(quiet: true) }
        } else {
            List {
                if !model.query.isEmpty && model.visible.isEmpty {
                    Text(t("mailbox.noResults")).font(.system(size: 14)).foregroundStyle(Palette.text3).listRowBackground(Palette.bg).listRowSeparator(.hidden)
                }
                ForEach(model.visible) { thread in
                    Group {
                        if model.folder == .drafts {
                            Button { model.openDraft(thread) } label: { ThreadRow(thread: thread, folder: model.folder) }.buttonStyle(.plain)
                        } else {
                            NavigationLink(value: thread.key) { ThreadRow(thread: thread, folder: model.folder) }
                        }
                    }
                        .swipeActions(edge: .leading) {
                            Button { model.setSeen(thread, thread.unread) } label: {
                                Label(t(thread.unread ? "mailbox.markRead" : "mailbox.markUnread"), systemImage: thread.unread ? "envelope.open" : "envelope.badge")
                            }.tint(.blue)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            if model.folder == .trash {
                                // Vermelho explícito: o tom geral do app (branco ou preto) também pintava o apagar.
                                Button(role: .destructive) { model.deleteForever(thread) } label: { Label(t("mailbox.deleteForever"), systemImage: "trash.slash") }.tint(.red)
                            } else {
                                Button(role: .destructive) { model.move(thread, to: "trash", text: t("mailbox.moved.trash")) } label: { Label(t("mailbox.delete"), systemImage: "trash") }.tint(.red)
                            }
                            if model.folder != .drafts {
                                let target = model.archiveTarget
                                Button { model.move(thread, to: target.folder, text: target.text) } label: { Label(target.label, systemImage: target.icon) }.tint(.gray)
                            }
                        }
                        .contextMenu { threadMenu(thread) }
                        .listRowBackground(Palette.bg)
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                        .onAppear { if thread.key == model.threads.last?.key { Task { await model.loadMore() } } }
                }
                if model.more { HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Palette.bg).listRowSeparator(.hidden) }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            // Cada pasta abre do topo.
            .id(model.folder)
            .refreshable { await model.refresh(quiet: true) }
        }
    }

    // Segurar em cima de uma conversa: as mesmas ações da página dela.
    @ViewBuilder private func threadMenu(_ thread: Thread) -> some View {
        Button { model.setSeen(thread, thread.unread) } label: {
            Label(t(thread.unread ? "mailbox.markRead" : "mailbox.markUnread"), systemImage: thread.unread ? "envelope.open" : "envelope.badge")
        }
        Button { model.toggleStar(thread) } label: { Label(t(thread.starred ? "mailbox.unstar" : "mailbox.star"), systemImage: thread.starred ? "star.slash" : "star") }
        Button { model.togglePin(thread) } label: { Label(t(thread.pinned ? "mailbox.unpin" : "mailbox.pin"), systemImage: thread.pinned ? "pin.slash" : "pin") }
        if model.folder != .drafts {
            let target = model.archiveTarget
            Button { model.move(thread, to: target.folder, text: target.text) } label: { Label(target.label, systemImage: target.icon) }
        }
        if model.folder != .spam && model.folder != .sent && model.folder != .drafts {
            Button(role: .destructive) { model.move(thread, to: "spam", text: t("mailbox.moved.spam")) } label: { Label(t("reader.markSpam"), systemImage: "xmark.shield") }
        }
        if model.folder == .trash {
            Button(role: .destructive) { model.deleteForever(thread) } label: { Label(t("mailbox.deleteForever"), systemImage: "trash.slash") }
        } else {
            Button(role: .destructive) { model.move(thread, to: "trash", text: t("mailbox.moved.trash")) } label: { Label(t("mailbox.delete"), systemImage: "trash") }
        }
    }

    // Só as pastas que não estão na barra de baixo.
    private var folderMenu: some View {
        Menu {
            ForEach([Folder.drafts, .archive, .trash]) { f in
                Button { model.open(f) } label: {
                    let n = model.counts[f.rawValue] ?? 0
                    Label(n > 0 && f != .trash ? "\(f.title)  \(n)" : f.title, systemImage: f.icon)
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal").font(.system(size: 17, weight: .medium))
        }
        .accessibilityLabel(t("mailbox.openMenu"))
    }

    private var accountMenu: some View {
        Menu {
            Section(model.session.user.address) {
                Button { settings = true } label: { Label(t("account.settings"), systemImage: "gearshape") }
            }
            let others = app.accounts.filter { $0.user.id != model.session.user.id }
            if !others.isEmpty {
                Section {
                    ForEach(others) { acc in
                        Button { app.switchTo(acc.slot) } label: { Label(acc.user.address, systemImage: "person.crop.circle") }
                    }
                }
            }
            if app.accounts.count < Accounts.maxSlots {
                Button { app.addAccount() } label: { Label(t("account.add"), systemImage: "person.crop.circle.badge.plus") }
            }
            Button(role: .destructive) { Task { await app.signOut() } } label: { Label(t("account.signOut"), systemImage: "rectangle.portrait.and.arrow.right") }
        } label: {
            Avatar(name: model.session.user.name, address: model.session.user.address, size: 30)
        }
        .accessibilityLabel(t("account.button", ["address": model.session.user.address]))
        .sheet(isPresented: $settings) { SettingsView(session: model.session).environmentObject(app) }
    }
}

struct ThreadRow: View {
    let thread: Thread
    let folder: Folder

    private var person: Person? {
        let i = thread.latest
        return folder == .sent ? i.h.to.first : (thread.items.last { $0.folder != "sent" }?.h.from ?? i.h.from)
    }

    var body: some View {
        let latest = thread.latest
        HStack(alignment: .top, spacing: 12) {
            Avatar(name: person?.name ?? "", address: person?.address ?? "?", size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if thread.unread { Circle().fill(Palette.text).frame(width: 7, height: 7) }
                    Text(displayName).font(.system(size: 15, weight: thread.unread ? .semibold : .regular)).foregroundStyle(Palette.text).lineLimit(1)
                    if thread.items.count > 1 { Text("\(thread.items.count)").font(.system(size: 12)).foregroundStyle(Palette.text3) }
                    if latest.sealedEnd { Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Palette.safe).accessibilityLabel(t("reader.e2e")) }
                    if latest.spoofed { Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(Palette.warn) }
                    Spacer(minLength: 4)
                    Text(listTime(latest.date)).font(.system(size: 12)).foregroundStyle(Palette.text3)
                }
                HStack(spacing: 4) {
                    Text(latest.h.subject.isEmpty ? t("common.noSubject") : latest.h.subject)
                        .font(.system(size: 14, weight: thread.unread ? .medium : .regular)).foregroundStyle(thread.unread ? Palette.text : Palette.text2).lineLimit(1)
                    Spacer(minLength: 0)
                    if thread.starred { Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Palette.text3) }
                    if latest.h.attachments > 0 { Image(systemName: "paperclip").font(.system(size: 11)).foregroundStyle(Palette.text3) }
                }
                Text(latest.h.snippet).font(.system(size: 13)).foregroundStyle(Palette.text3).lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private var displayName: String {
        guard let p = person else { return "?" }
        return p.name.isEmpty ? p.address : p.name
    }
}
