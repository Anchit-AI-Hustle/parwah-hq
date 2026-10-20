import XCTest
@testable import ParwahCore

/// A server answering exactly as api/ does, scripted per test.
final class FakeServer: Transport, @unchecked Sendable {
    var status = 200
    var reply = "{}"
    var sent: [(line: String, headers: [String: String], body: String?)] = []
    var fail = false
    func send(method: String, url: String, headers: [String: String], body: Data?) async throws -> (Int, Data) {
        if fail { throw URLError(.notConnectedToInternet) }
        sent.append(("\(method) \(url)", headers, body.flatMap { String(data: $0, encoding: .utf8) }))
        return (status, Data(reply.utf8))
    }
}

final class PinTests: XCTestCase {
    /// The phone's PIN rule is the server's, checked against what the server itself wrote.
    func testEveryFourNumberPinIsJudgedExactlyAsTheServerJudgesIt() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../contract/contract.json").standardized
        let all = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let refused = (all["pin"] as! [String: Any])["refused"] as! [String: String]
        var wrong: [String] = []
        for i in 0..<10000 {
            let p = String(format: "%04d", i)
            if Pin.error(p) != refused[p] { wrong.append(p) }
        }
        XCTAssertEqual(wrong, [], "differs from the server")
        for (pin, why) in refused where pin.count != 4 || !pin.allSatisfy(\.isNumber) {
            XCTAssertEqual(Pin.error(pin), why, "for \"\(pin)\"")
        }
        XCTAssertNil(Pin.error("4829"))
    }
}

final class AuthTests: XCTestCase {
    let server = FakeServer()
    let tokens = MemoryTokenStore()
    lazy var api = Api(base: "https://parwah.test/", transport: server, tokens: tokens, timeZone: { "Asia/Kolkata" })
    lazy var auth = AuthClient(api: api, tokens: tokens)
    func answer(_ s: Int, _ j: String) { server.status = s; server.reply = j }

    func testEveryAnswerOfTheSignInStep() async throws {
        answer(200, #"{"ok":true,"exists":false}"#)
        do { let got = try await auth.enter(phone: "9820000001"); XCTAssertEqual(got, .newNumber(error: nil)) }
        answer(200, #"{"ok":true,"exists":true,"needPin":true,"older":true}"#)
        do { let got = try await auth.enter(phone: "9820000001"); XCTAssertEqual(got, .askPin(older: true)) }
        answer(200, #"{"ok":true,"exists":true,"setPin":true}"#)
        do { let got = try await auth.enter(phone: "9820000001"); XCTAssertEqual(got, .choosePin(error: nil)) }
        answer(200, #"{"ok":true,"exists":true,"changeSecret":true,"name":"Asha"}"#)
        do { let got = try await auth.enter(phone: "9820000001", pin: "old"); XCTAssertEqual(got, .replaceSecret(name: "Asha", error: nil)) }
        answer(401, #"{"ok":false,"wrongPin":true,"left":3,"error":"That PIN is not right. 3 tries left."}"#)
        do { let got = try await auth.enter(phone: "9820000001", pin: "4829"); XCTAssertEqual(got, .wrongPin(left: 3, error: "That PIN is not right. 3 tries left.")) }
        answer(429, #"{"ok":false,"locked":true,"error":"Locked for 15 minutes."}"#)
        do { let got = try await auth.enter(phone: "9820000001", pin: "4829"); XCTAssertEqual(got, .locked("Locked for 15 minutes.")) }
    }

    func testSigningInKeepsTheTokenAndListsTheBusiestFamilyFirst() async throws {
        answer(200, #"{"ok":true,"exists":true,"token":"tok123","toured":true,"user":{"id":"u1","name":"Asha","phone":"+919820000001"},"circles":[{"code":"QUIET","circleName":"Quiet","memberId":"m1"},{"code":"BUSY","circleName":"Busy","memberId":"m2","unread":4},{"code":"LIVE","circleName":"Live","memberId":"m3","live":1,"role":"parent"}]}"#)
        guard case let .signedIn(user, circles, toured) = try await auth.enter(phone: "9820000001", pin: "4829") else { return XCTFail() }
        XCTAssertEqual(tokens.token, "tok123")
        XCTAssertEqual(circles.map(\.code), ["LIVE", "BUSY", "QUIET"])
        XCTAssertTrue(circles[0].isElder)
        XCTAssertEqual(user.name, "Asha")
        XCTAssertTrue(toured)
    }

    func testEveryCallCarriesTheTokenInAHeaderAndTheTimeZone() async throws {
        tokens.token = "tok123"
        answer(200, #"{"ok":true,"exists":true,"needPin":true}"#)
        _ = try await auth.enter(phone: "9820000001")
        let s = server.sent.last!
        XCTAssertEqual(s.line, "POST https://parwah.test/api/auth/")
        XCTAssertEqual(s.headers["X-Parwah-Token"], "tok123")
        XCTAssertEqual(s.headers["X-Parwah-Tz"], "Asia/Kolkata")
        XCTAssertFalse(s.body!.contains("tok123"), "the token never rides in the body")
    }

    func testAnEndedSessionDropsTheTokenAndSaysSignIn() async {
        tokens.token = "stale"
        answer(401, #"{"ok":false,"error":"Not a member"}"#)
        do { _ = try await api.get("/api/care/?circle=X&member=Y"); XCTFail() } catch let e as ApiError {
            guard case .signedOut = e else { return XCTFail() }
        } catch { XCTFail() }
        XCTAssertNil(tokens.token)
    }

    func testFailuresAreSaidPlainly() async {
        answer(500, "<html>oops</html>")
        do { _ = try await api.get("/api/events/"); XCTFail() } catch let e as ApiError { XCTAssertTrue(e.message.contains("on our side")) } catch { XCTFail() }
        server.fail = true
        do { _ = try await api.get("/api/events/"); XCTFail() } catch let e as ApiError { XCTAssertTrue(e.message.contains("check your internet")) } catch { XCTFail() }
    }

    func testSigningOutForgetsTheTokenEvenOffline() async {
        tokens.token = "tok123"; server.fail = true
        await auth.signOut()
        XCTAssertNil(tokens.token)
    }
}

final class FamilyTests: XCTestCase {
    let server = FakeServer()
    lazy var client = FamilyClient(api: Api(base: "https://parwah.test", transport: server, tokens: MemoryTokenStore("t"), timeZone: { "Asia/Kolkata" }))
    let seat = Seat(code: "SHARMA", circleName: "Sharma Family", memberId: "m1", name: "Rohan", role: "family")

    func testTodayIsReadFromTheSameReplyTheWebAppReads() async throws {
        server.reply = #"{"ok":true,"circleName":"Sharma Family","code":"SHARMA","counts":{"docs":12},"members":[{"id":"m1","name":"Rohan Sharma","role":"family","gift_info":{}},{"id":"m2","name":"Papa","role":"parent","kin":"Father"}],"events":[{"id":"e1","type":"checkin","text":"","created_at":"2026-10-20T08:00:00Z","member_id":"m2","member_name":"Papa"}],"calls":[],"joinRequests":[{"id":"j1","name":"Meera","created_at":"x"}],"sos":[],"seenAt":null}"#
        let f = try await client.load(seat)
        XCTAssertEqual(server.sent.last!.line, "GET https://parwah.test/api/events/?circle=SHARMA&member=m1")
        XCTAssertEqual(f.docs, 12)
        XCTAssertEqual(f.member("m2")?.isElder, true)
        XCTAssertEqual(f.member("m2")?.kin, "Father")
        XCTAssertEqual(f.member("m1")?.firstName, "Rohan")
        XCTAssertEqual(f.events.first?.type, "checkin")
        XCTAssertEqual(f.joinRequests.first?.name, "Meera")
    }

    func testAnEldersButtonsSendWhatTheWebSends() async throws {
        server.reply = #"{"ok":true}"#
        try await client.checkIn(seat)
        XCTAssertTrue(server.sent.last!.body!.contains(#""type":"checkin""#))
        try await client.medicinesTaken(seat)
        XCTAssertTrue(server.sent.last!.body!.contains(#""type":"pill""#))
    }

    func testJoiningCleansTheCodeAndSaysWhenYouAreWaiting() async throws {
        server.status = 202
        server.reply = #"{"ok":true,"pending":true,"circleName":"Sharma Family","code":"SHARMA","message":"Your request has gone to Sharma Family."}"#
        let j = try await client.join(user: User(id: "u1", name: "Meera"), code: " sharma-1 ", memberName: "Meera")
        XCTAssertTrue(server.sent.last!.body!.contains(#""code":"SHARMA1""#))
        XCTAssertEqual(j, .waiting(circleName: "Sharma Family", message: "Your request has gone to Sharma Family."))
    }
}
