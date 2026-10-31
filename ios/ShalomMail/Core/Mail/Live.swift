// Caixa ao vivo, igual ao web/src/lib/live.ts: um WebSocket com a caixa no servidor avisa quando chega ou
// muda algo (o aviso não traz conteúdo) e a lista busca de novo. Ping a cada 25 s; dois sem resposta e a
// conexão é dada como morta. Reconecta com espera crescente.
import Foundation

extension Notification.Name {
    static let mailboxChanged = Notification.Name("shalom.mailbox-changed")
}

@MainActor
final class Live {
    static let shared = Live()
    private var task: URLSessionWebSocketTask?
    private var wait: TimeInterval = 1
    private var heard = Date()
    private var ping: Timer?
    private var stopped = true

    func start() {
        stopped = false
        connect()
    }

    func stop() {
        stopped = true
        ping?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func connect() {
        guard !stopped else { return }
        let base = API.shared.base
        var comps = URLComponents(url: API.shared.url("/live"), resolvingAgainstBaseURL: false)!
        comps.scheme = base.scheme == "https" ? "wss" : "ws"
        comps.queryItems = [URLQueryItem(name: "slot", value: String(API.shared.slot))]
        var req = URLRequest(url: comps.url!)
        // O servidor confere a origem (defesa do navegador contra outros sites); o app é o próprio Shalom.
        req.setValue(API.shared.origin, forHTTPHeaderField: "Origin")
        let ws = API.shared.session.webSocketTask(with: req)
        task = ws
        heard = Date()
        ws.resume()
        receive(ws)
        ping?.invalidate()
        ping = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(ws) }
        }
    }

    private func tick(_ ws: URLSessionWebSocketTask) {
        guard ws === task else { return }
        if Date().timeIntervalSince(heard) > 60 { lost(ws); return }
        ws.send(.string("ping")) { _ in }
    }

    private func receive(_ ws: URLSessionWebSocketTask) {
        ws.receive { [weak self] result in
            Task { @MainActor in
                guard let self, ws === self.task else { return }
                switch result {
                case .success(let msg):
                    self.heard = Date()
                    if self.wait > 1 { NotificationCenter.default.post(name: .mailboxChanged, object: nil) }
                    self.wait = 1
                    if case .string(let s) = msg, s != "pong" { NotificationCenter.default.post(name: .mailboxChanged, object: nil) }
                    self.receive(ws)
                case .failure: self.lost(ws)
                }
            }
        }
    }

    private func lost(_ ws: URLSessionWebSocketTask) {
        guard ws === task else { return }
        ws.cancel()
        task = nil
        ping?.invalidate()
        guard !stopped else { return }
        let delay = wait
        wait = min(wait * 2, 30)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connect() }
    }
}
