import Foundation
import Security
import ParwahCore

/// The real network: URLSession, HTTPS only.
struct URLSessionTransport: Transport {
    func send(method: String, url: String, headers: [String: String], body: Data?) async throws -> (Int, Data) {
        guard let u = URL(string: url) else { throw URLError(.badURL) }
        var r = URLRequest(url: u, timeoutInterval: 30)
        r.httpMethod = method
        headers.forEach { r.setValue($1, forHTTPHeaderField: $0) }
        r.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: r)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
}

/// The session token in the Keychain, for this device only: not in iCloud
/// Keychain, not in a backup restored to another phone.
final class KeychainTokenStore: TokenStore {
    private let account = "parwah-session"
    var token: String? {
        get {
            var out: AnyObject?
            let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
            return String(data: d, encoding: .utf8)
        }
        set {
            let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account]
            SecItemDelete(base as CFDictionary)
            guard let v = newValue else { return }
            var add = base
            add[kSecValueData as String] = Data(v.utf8)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(add as CFDictionary, nil)
        }
    }
}

/// What is remembered between launches besides the token: who, and which family. Nothing secret.
final class Remembered {
    private let d: UserDefaults
    init(_ d: UserDefaults = .standard) { self.d = d }
    private func get<T: Decodable>(_ k: String) -> T? { d.data(forKey: k).flatMap { try? JSONDecoder().decode(T.self, from: $0) } }
    private func set<T: Encodable>(_ k: String, _ v: T?) { if let v, let data = try? JSONEncoder().encode(v) { d.set(data, forKey: k) } else { d.removeObject(forKey: k) } }
    var user: User? { get { get("user") } set { set("user", newValue) } }
    var seat: Seat? { get { get("seat") } set { set("seat", newValue) } }
    var cc: String { get { d.string(forKey: "cc") ?? "+91" } set { d.set(newValue, forKey: "cc") } }
    func clear() { ["user", "seat", "cc"].forEach(d.removeObject(forKey:)) }
}
