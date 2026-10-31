// Contas abertas neste iPhone (até 5, como no navegador): cada uma numa vaga, com o próprio cookie de sessão
// no servidor (cabeçalho X-Shalom-Slot). Aqui fica só quem é cada conta; a chave fica no Vault.
import Foundation

struct User: Codable, Equatable, Hashable {
    let id: String
    let address: String
    var name: String
    let publicKey: String
}

struct StoredAccount: Codable, Equatable, Identifiable {
    let slot: Int
    let user: User
    var id: String { user.id }
}

enum Accounts {
    private static let listKey = "shalom-accounts"
    private static let slotKey = "shalom-slot"
    static let maxSlots = 5

    static var all: [StoredAccount] {
        guard let data = UserDefaults.standard.data(forKey: listKey), let list = try? JSONDecoder().decode([StoredAccount].self, from: data) else { return [] }
        return list.sorted { $0.slot < $1.slot }
    }

    private static func save(_ list: [StoredAccount]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(list), forKey: listKey)
    }

    static var currentSlot: Int {
        get { let n = UserDefaults.standard.integer(forKey: slotKey); return (0 ..< maxSlots).contains(n) ? n : 0 }
        set { UserDefaults.standard.set(newValue, forKey: slotKey) }
    }

    static var current: StoredAccount? { all.first { $0.slot == currentSlot } }

    static func keep(_ user: User, slot: Int) {
        save(all.filter { $0.slot != slot && $0.user.id != user.id } + [StoredAccount(slot: slot, user: user)])
    }

    static func drop(slot: Int) { save(all.filter { $0.slot != slot }) }

    static func freeSlot() -> Int? { (0 ..< maxSlots).first { s in !all.contains { $0.slot == s } } }
}
