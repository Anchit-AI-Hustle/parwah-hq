import Foundation

public struct Member: Codable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let role: String?
    public let phone: String?
    public let place: String?
    public let relation: String?
    public let kin: String?
    public var isElder: Bool { role == "parent" }
    public var firstName: String { String(name.trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "") }
}

public struct FamilyEvent: Codable, Equatable, Identifiable {
    public let id: String
    public let type: String
    public let text: String?
    public let created_at: String
    public let member_id: String?
    public let member_name: String?
}

public struct JoinRequest: Codable, Equatable, Identifiable {
    public let id: String
    public let name: String
}

public struct OpenSos: Codable, Equatable, Identifiable {
    public let id: String
    public let member_id: String
    public let status: String
    public let name: String
    public let phone: String?
}

/// Everything Today needs, from one GET /api/events.
public struct Family: Equatable {
    public let name: String
    public let code: String
    public let members: [Member]
    public let events: [FamilyEvent]
    public let joinRequests: [JoinRequest]
    public let sos: [OpenSos]
    public let docs: Int?
    public func member(_ id: String) -> Member? { members.first { $0.id == id } }
}

/// Where this phone stands: which family, as which member. Saved between launches.
public struct Seat: Codable, Equatable {
    public let code: String
    public let circleName: String
    public let memberId: String
    public let name: String
    public let role: String
    public var isElder: Bool { role == "parent" }
    public init(code: String, circleName: String, memberId: String, name: String, role: String) {
        self.code = code; self.circleName = circleName; self.memberId = memberId; self.name = name; self.role = role
    }
}

public extension Circle {
    func seat(personName: String) -> Seat { Seat(code: code, circleName: circleName, memberId: memberId, name: memberName ?? personName, role: role) }
}

public enum Joined: Equatable {
    case joined(Seat)
    case waiting(circleName: String, message: String)
    case refused(String)
}

public final class FamilyClient {
    let api: Api
    public init(api: Api) { self.api = api }

    private func q(_ v: String) -> String { v.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? v }

    public func load(_ seat: Seat) async throws -> Family {
        let r = try await api.get("/api/events/?circle=\(q(seat.code))&member=\(q(seat.memberId))")
        guard r.ok else { throw ApiError.unreachable(r.error ?? "Could not load the family. Please try again.") }
        let j = r.json
        return Family(
            name: j["circleName"] as? String ?? seat.circleName,
            code: j["code"] as? String ?? seat.code,
            members: api.decode([Member].self, j["members"]) ?? [],
            events: api.decode([FamilyEvent].self, j["events"]) ?? [],
            joinRequests: api.decode([JoinRequest].self, j["joinRequests"]) ?? [],
            sos: api.decode([OpenSos].self, j["sos"]) ?? [],
            docs: (j["counts"] as? [String: Any])?["docs"] as? Int
        )
    }

    /// "All is well" from an elder's big button.
    public func checkIn(_ seat: Seat) async throws { try await event(seat, "checkin") }
    /// "Medicines taken" from an elder's big button.
    public func medicinesTaken(_ seat: Seat) async throws { try await event(seat, "pill") }

    private func event(_ seat: Seat, _ type: String) async throws {
        let r = try await api.post("/api/events/", ["code": seat.code, "memberId": seat.memberId, "type": type])
        guard r.ok else { throw ApiError.unreachable(r.error ?? "That did not reach the family. Please try again.") }
    }

    public func create(user: User, memberName: String, circleName: String, elder: Bool = false) async throws -> Seat {
        let r = try await api.post("/api/circle/", ["action": "create", "kind": "family", "familyType": "nuclear",
            "memberName": memberName, "circleName": circleName, "userId": user.id,
            "role": elder ? "parent" : "family", "relation": "family"])
        guard r.ok else { throw ApiError.unreachable(r.error ?? "Could not make the family. Please try again.") }
        return seat(r, memberName)
    }

    public func join(user: User, code: String, memberName: String, elder: Bool = false) async throws -> Joined {
        let clean = String(code.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(12))
        let r = try await api.post("/api/circle/", ["action": "join", "code": clean, "memberName": memberName,
            "userId": user.id, "role": elder ? "parent" : "family", "relation": "family"])
        guard r.ok else { return .refused(r.error ?? "Could not join. Please check the code and try again.") }
        if r.flag("pending") {
            return .waiting(circleName: r.json["circleName"] as? String ?? clean, message: r.json["message"] as? String ?? "Your request has gone to the family.")
        }
        return .joined(seat(r, memberName))
    }

    private func seat(_ r: Reply, _ memberName: String) -> Seat {
        Seat(code: r.json["code"] as? String ?? "", circleName: r.json["circleName"] as? String ?? "",
             memberId: r.json["memberId"] as? String ?? "", name: memberName, role: r.json["role"] as? String ?? "family")
    }
}
