import Foundation

public struct User: Codable, Equatable {
    public let id: String
    public let name: String
    public let phone: String?
    public init(id: String, name: String, phone: String? = nil) { self.id = id; self.name = name; self.phone = phone }
}

/// One family or group this person belongs to, as the circle list shows it.
public struct Circle: Codable, Equatable, Identifiable {
    public var id: String { code }
    public let code: String
    public let circleName: String
    public let kind: String
    public let memberId: String
    public let role: String
    public let memberName: String?
    public let memberCount: Int
    public let unread: Int
    public let openRequests: Int
    public let waiting: Int
    public let live: Int
    public var isElder: Bool { role == "parent" }

    enum CodingKeys: String, CodingKey { case code, circleName, kind, memberId, role, memberName, memberCount, unread, openRequests, waiting, live }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        circleName = try c.decode(String.self, forKey: .circleName)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "family"
        memberId = try c.decode(String.self, forKey: .memberId)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "family"
        memberName = try c.decodeIfPresent(String.self, forKey: .memberName)
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 0
        unread = try c.decodeIfPresent(Int.self, forKey: .unread) ?? 0
        openRequests = try c.decodeIfPresent(Int.self, forKey: .openRequests) ?? 0
        waiting = try c.decodeIfPresent(Int.self, forKey: .waiting) ?? 0
        live = try c.decodeIfPresent(Int.self, forKey: .live) ?? 0
    }
}

/// Every answer the sign-in step can give (api/auth.mjs, action 'enter').
public enum Enter: Equatable {
    case newNumber(error: String?)
    case askPin(older: Bool)
    case choosePin(error: String?)
    case replaceSecret(name: String?, error: String?)
    case wrongPin(left: Int?, error: String)
    case locked(String)
    case signedIn(user: User, circles: [Circle], toured: Bool)
    case refused(String)
}

public final class AuthClient {
    let api: Api
    let tokens: TokenStore
    public init(api: Api, tokens: TokenStore) { self.api = api; self.tokens = tokens }

    /// Sign in, or sign up, in one step, exactly as the web app does.
    public func enter(phone: String, cc: String = "+91", name: String? = nil, pin: String? = nil, newPin: String? = nil) async throws -> Enter {
        read(try await api.post("/api/auth/", ["action": "enter", "phone": phone, "cc": cc, "name": name, "pin": pin, "newPin": newPin, "device": "iphone"]))
    }

    /// The circle list again, for a person already signed in. Issues no new token.
    public func refresh(phone: String, cc: String = "+91") async throws -> Enter {
        read(try await api.post("/api/auth/", ["action": "enter", "phone": phone, "cc": cc, "refresh": true]))
    }

    public func signOut() async {
        let t = tokens.token
        _ = try? await api.post("/api/auth/", ["action": "signout", "token": t])
        tokens.token = nil
    }

    func read(_ r: Reply) -> Enter {
        if r.flag("locked") { return .locked(r.error ?? "Too many tries. Please wait 15 minutes.") }
        if r.flag("wrongPin") { return .wrongPin(left: r.json["left"] as? Int, error: r.error ?? "That PIN is not right.") }
        if !r.ok { return .refused(r.error ?? "Something went wrong on our side. Please try again in a minute.") }
        if !r.flag("exists") { return .newNumber(error: r.error) }
        if r.flag("changeSecret") { return .replaceSecret(name: r.json["name"] as? String, error: r.error) }
        if r.flag("setPin") { return .choosePin(error: r.error) }
        guard !r.flag("needPin"), let user = api.decode(User.self, r.json["user"]) else { return .askPin(older: r.flag("older")) }
        if let t = r.json["token"] as? String { tokens.token = t }
        // Busiest first, as on the web: a live call, someone waiting to be let
        // in, unread messages, open requests. Ties keep the server's order.
        let circles = (api.decode([Circle].self, r.json["circles"]) ?? []).enumerated().sorted {
            let a = ($0.element.live, $0.element.waiting, $0.element.unread, $0.element.openRequests)
            let b = ($1.element.live, $1.element.waiting, $1.element.unread, $1.element.openRequests)
            return a != b ? a > b : $0.offset < $1.offset
        }.map(\.element)
        return .signedIn(user: user, circles: circles, toured: r.flag("toured"))
    }
}
