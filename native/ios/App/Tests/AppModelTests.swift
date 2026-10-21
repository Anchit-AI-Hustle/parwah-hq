import XCTest
import ParwahCore
@testable import Parwah

@MainActor
final class AppModelTests: XCTestCase {
    private func model() -> AppModel {
        let d = UserDefaults(suiteName: "parwah-test-\(UUID().uuidString)")!
        return AppModel(transport: ScriptedServer(), tokens: MemoryTokenStore(), remembered: Remembered(d))
    }
    private func settle(_ m: AppModel, until: @escaping () -> Bool) async {
        for _ in 0..<100 where !until() { try? await Task.sleep(nanoseconds: 20_000_000) }
    }

    func testAnElderSignsInAndTellsTheFamilyAllIsWell() async {
        let m = model()
        await settle(m) { m.step == .phone }
        await m.submitPhone("9820000001", cc: "+91")
        XCTAssertEqual(m.step, .pin(older: false))
        await m.submitPin("1111")
        XCTAssertEqual(m.message, "That PIN is not right. 4 tries left.")
        await m.submitPin("4829")
        guard case .circles(let c) = m.step else { return XCTFail("expected the family list") }
        await m.pick(c[0])
        guard case .today(let seat) = m.step else { return XCTFail("expected Today") }
        XCTAssertTrue(seat.isElder)
        XCTAssertEqual(m.family?.docs, 12)
        await m.checkIn()
        XCTAssertEqual(m.message, "The family can see you are well.")
    }


    func testATooShortNumberIsSaidPlainly() async {
        let m = model()
        await settle(m) { m.step == .phone }
        await m.submitPhone("123", cc: "+91")
        XCTAssertEqual(m.message, "Please check the number. It looks too short.")
        XCTAssertEqual(m.step, .phone)
    }
}
