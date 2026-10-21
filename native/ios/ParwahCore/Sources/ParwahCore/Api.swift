import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One HTTP exchange. The app plugs in URLSession; tests plug in a fake.
public protocol Transport: Sendable {
    func send(method: String, url: String, headers: [String: String], body: Data?) async throws -> (Int, Data)
}

/// Where the session token lives: the Keychain on a phone, memory in tests.
public protocol TokenStore: AnyObject {
    var token: String? { get set }
}

public final class MemoryTokenStore: TokenStore {
    public var token: String?
    public init(_ token: String? = nil) { self.token = token }
}

public struct Reply {
    public let status: Int
    public let json: [String: Any]
    public var ok: Bool { json["ok"] as? Bool == true }
    public var error: String? { json["error"] as? String }
    public func flag(_ k: String) -> Bool { json[k] as? Bool == true }
}

public enum ApiError: Error, Equatable {
    /// The session is over: the person must sign in again.
    case signedOut(String)
    /// The network or the server failed; the screen says so and offers to try again.
    case unreachable(String)

    public var message: String {
        switch self { case .signedOut(let m), .unreachable(let m): return m }
    }
}

/// The client for the same API the web app uses (the handlers in api/).
///
/// Every call carries the session token in X-Parwah-Token, never in the
/// address, and the phone's time zone in X-Parwah-Tz. signin:true, or any
/// 401 that is not a wrong PIN, drops the token and throws .signedOut.
public final class Api {
    let base: String
    let transport: Transport
    let tokens: TokenStore
    let timeZone: () -> String

    public init(base: String, transport: Transport, tokens: TokenStore, timeZone: @escaping () -> String = { TimeZone.current.identifier }) {
        self.base = base; self.transport = transport; self.tokens = tokens; self.timeZone = timeZone
    }

    public func post(_ path: String, _ body: [String: Any?]) async throws -> Reply {
        let clean = body.compactMapValues { $0 }
        return try await call("POST", path, try JSONSerialization.data(withJSONObject: clean, options: [.sortedKeys]))
    }

    public func get(_ path: String) async throws -> Reply { try await call("GET", path, nil) }

    private func call(_ method: String, _ path: String, _ body: Data?) async throws -> Reply {
        var headers = ["Accept": "application/json", "X-Parwah-Tz": timeZone()]
        if body != nil { headers["Content-Type"] = "application/json" }
        if let t = tokens.token { headers["X-Parwah-Token"] = t }
        let url = (base.hasSuffix("/") ? String(base.dropLast()) : base) + path
        let status: Int, data: Data
        do { (status, data) = try await transport.send(method: method, url: url, headers: headers, body: body) }
        catch { throw ApiError.unreachable("We could not reach Parwah. Please check your internet and try again.") }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            if status == 401 { tokens.token = nil; throw ApiError.signedOut("Please sign in again") }
            throw ApiError.unreachable("Something went wrong on our side. Please try again in a minute.")
        }
        let r = Reply(status: status, json: obj)
        if r.flag("signin") || (status == 401 && !r.flag("wrongPin")) {
            tokens.token = nil
            throw ApiError.signedOut(r.error ?? "Please sign in again")
        }
        return r
    }

    func decode<T: Decodable>(_ type: T.Type, _ value: Any?) -> T? {
        guard let value, JSONSerialization.isValidJSONObject(value) || value is [Any],
              let d = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(T.self, from: d)
    }
}
