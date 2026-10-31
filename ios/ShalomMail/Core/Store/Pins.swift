// Chave de cada contato Shalom fixada na primeira vez que este iPhone a viu (trust on first use), separada por
// conta, como web/src/lib/pins.ts. Se o servidor um dia entregar outra chave para o mesmo endereço, o selo de
// conferido cai e o envio para. Arquivo protegido pelo iOS (só abre com o iPhone desbloqueado).
import Foundation

struct Pin: Codable { var pub: String; var firstSeen: Double; var confirmed: Bool? }

actor Pins {
    static let shared = Pins()
    private var cache: [String: Pin]?

    private var file: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("pins.json")
    }

    private func all() -> [String: Pin] {
        if let cache { return cache }
        let loaded = (try? JSONDecoder().decode([String: Pin].self, from: Data(contentsOf: file))) ?? [:]
        cache = loaded
        return loaded
    }

    private func write(_ pins: [String: Pin]) {
        cache = pins
        try? JSONEncoder().encode(pins).write(to: file, options: [.atomic, .completeFileProtection])
    }

    private func key(_ userId: String, _ address: String) -> String { "\(userId):\(address.lowercased())" }

    // Devolve a chave fixada; na primeira vez, fixa a que veio.
    func check(_ userId: String, _ address: String, _ pub: String) -> String {
        var pins = all()
        if let p = pins[key(userId, address)] { return p.pub }
        pins[key(userId, address)] = Pin(pub: pub, firstSeen: Date().timeIntervalSince1970 * 1000)
        write(pins)
        return pub
    }

    func state(_ userId: String, _ address: String) -> Pin? { all()[key(userId, address)] }

    func confirm(_ userId: String, _ address: String, _ pub: String) -> Bool {
        var pins = all()
        let k = key(userId, address)
        if let p = pins[k], p.pub != pub { return false }
        pins[k] = Pin(pub: pub, firstSeen: pins[k]?.firstSeen ?? Date().timeIntervalSince1970 * 1000, confirmed: true)
        write(pins)
        return true
    }

    func trustNew(_ userId: String, _ address: String, _ pub: String) {
        var pins = all()
        pins[key(userId, address)] = Pin(pub: pub, firstSeen: Date().timeIntervalSince1970 * 1000, confirmed: true)
        write(pins)
    }
}
