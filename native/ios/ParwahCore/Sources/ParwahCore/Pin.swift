import Foundation

/// The PIN a person chooses. The same rule as the server's pinError
/// (api/_auth.mjs), word for word. PinTests checks every 4-number PIN
/// against native/contract/contract.json, which the server itself writes.
public enum Pin {
    public static let length = 4

    static let weak: Set<String> = [
        "1234", "4321", "1212", "1122", "2580", "0852", "1004", "2000", "2020",
        "6969", "1313", "2468", "1357", "0123", "9876", "5683", "7777", "1010",
        "2121", "1111", "0000", "2001", "1990", "1230", "0007",
    ]
    static let guessable = "That PIN is one of the first anyone would try. Please pick another."

    /// Why this PIN cannot be chosen, or nil when it can.
    public static func error(_ pin: String) -> String? {
        if pin.isEmpty { return "Choose a PIN of 4 numbers." }
        if !pin.unicodeScalars.allSatisfy({ $0.value >= 48 && $0.value <= 57 }) { return "A PIN is numbers only - 4 of them." }
        if pin.count != length { return "A PIN is exactly 4 numbers, and you typed \(pin.count)." }
        if weak.contains(pin) || Set(pin).count == 1 { return guessable }
        let d = pin.compactMap { $0.wholeNumberValue }
        let up = (1..<d.count).allSatisfy { d[$0] == d[$0 - 1] + 1 }
        let down = (1..<d.count).allSatisfy { d[$0] == d[$0 - 1] - 1 }
        return up || down ? guessable : nil
    }
}
