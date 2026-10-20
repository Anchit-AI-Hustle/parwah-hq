#if DEBUG
import Foundation
import ParwahCore

/// A server that answers exactly as api/ does, for UI tests only (launched
/// with -uitest). Debug builds only: a release build does not contain it.
struct ScriptedServer: Transport {
    func send(method: String, url: String, headers: [String: String], body: Data?) async throws -> (Int, Data) {
        let b = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let (s, j): (Int, String)
        if b.contains(#""action":"enter""#) && !b.contains(#""pin""#) {
            (s, j) = (200, #"{"ok":true,"exists":true,"needPin":true}"#)
        } else if b.contains(#""pin":"1111""#) {
            (s, j) = (401, #"{"ok":false,"wrongPin":true,"left":4,"error":"That PIN is not right. 4 tries left."}"#)
        } else if b.contains(#""pin":"4829""#) {
            (s, j) = (200, #"{"ok":true,"exists":true,"token":"tok","toured":true,"user":{"id":"u1","name":"Papa","phone":"+919820000001"},"circles":[{"code":"SHARMA","circleName":"Sharma Family","memberId":"m2","role":"parent","memberCount":3,"unread":2}]}"#)
        } else if url.contains("/api/events/?") {
            (s, j) = (200, #"{"ok":true,"circleName":"Sharma Family","code":"SHARMA","counts":{"docs":12},"members":[{"id":"m1","name":"Rohan","role":"family"},{"id":"m2","name":"Papa","role":"parent"},{"id":"m3","name":"Meera","role":"family"}],"events":[{"id":"e1","type":"checkin","created_at":"2026-10-20T08:00:00Z","member_id":"m3","member_name":"Meera"}],"calls":[],"joinRequests":[],"sos":[]}"#)
        } else if b.contains(#""type":"checkin""#) {
            (s, j) = (200, #"{"ok":true}"#)
        } else {
            (s, j) = (404, #"{"ok":false,"error":"not scripted"}"#)
        }
        return (s, Data(j.utf8))
    }
}

final class MemoryTokenStoreBox: TokenStore { var token: String? }
#endif
