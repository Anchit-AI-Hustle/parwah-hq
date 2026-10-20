import SwiftUI

/// Mela, the same tokens as the website and the Android app.
enum Mela {
    static let jamun = Color(hex: 0x2A1235)
    static let day = Color(hex: 0xFFF6EA)
    static let blush = Color(hex: 0xFFE9DA)
    static let marigold = Color(hex: 0xFFB31A)
    static let flame = Color(hex: 0xFF5B2E)
    static let ink = Color(hex: 0x221428)
    static let inkSoft = Color(hex: 0x5E4B5E)
    static let onBright = Color(hex: 0x1E0F26)
    static let sindoor = Color(hex: 0xB80F5E)
    static let cream = Color(hex: 0xFFF3E6)
    static let dimOnDusk = Color(hex: 0xD2BCD9)
    static let nightDay = Color(hex: 0x1C0B24)
    static let nightCard = Color(hex: 0x2A1532)
    static let nightBlush = Color(hex: 0x26112F)
    static let raniNight = Color(hex: 0xFF7AB6)
    /// Emergency red: SOS and nothing else.
    static let sos = Color(hex: 0xC62828)
    static let grad = LinearGradient(colors: [marigold, flame], startPoint: .leading, endPoint: .trailing)
}

/// The colours a screen uses, for the light or the night theme.
struct Palette {
    let ground, card, quiet, text, soft, link: Color
    static func of(_ s: ColorScheme) -> Palette {
        s == .dark
            ? Palette(ground: Mela.nightDay, card: Mela.nightCard, quiet: Mela.nightBlush, text: Mela.cream, soft: Mela.dimOnDusk, link: Mela.raniNight)
            // Marigold text on the light ground is 1.8:1; links take the rani ink, as on the website.
            : Palette(ground: Mela.day, card: .white, quiet: Mela.blush, text: Mela.ink, soft: Mela.inkSoft, link: Mela.sindoor)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
