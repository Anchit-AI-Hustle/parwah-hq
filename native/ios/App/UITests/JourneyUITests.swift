import XCTest

/// A person signs in and reaches their family's Today on an iPhone
/// simulator, through the real SwiftUI screens, against the scripted server
/// built into Debug builds. Each step's screenshot is kept in the results.
final class JourneyUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    func testAnElderSignsInAndTellsTheFamilyAllIsWell() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()

        let number = app.textFields["Mobile number"]
        XCTAssertTrue(number.waitForExistence(timeout: 10))
        number.tap(); number.typeText("9820000001")
        shot(app, "1-phone")
        app.buttons["Continue"].tap()

        let pin = app.secureTextFields["PIN"]
        XCTAssertTrue(pin.waitForExistence(timeout: 10))
        pin.tap(); pin.typeText("1111")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.staticTexts["That PIN is not right. 4 tries left."].waitForExistence(timeout: 10))
        shot(app, "2-wrong-pin")

        pin.tap()
        pin.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4) + "4829")
        app.buttons["Sign in"].tap()
        let family = app.buttons["Sharma Family"]
        XCTAssertTrue(family.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["2 new messages"].exists)
        shot(app, "3-families")

        family.tap()
        let well = app.buttons["All is well"]
        XCTAssertTrue(well.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["12 papers kept"].exists)
        XCTAssertTrue(app.staticTexts["Meera said all is well"].exists)
        shot(app, "4-today-elder")

        well.tap()
        XCTAssertTrue(app.staticTexts["The family can see you are well."].waitForExistence(timeout: 10))
        shot(app, "5-checked-in")
    }
}
