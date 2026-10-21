package com.parwah.android

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Mela, the same tokens as site/public/styles.css and the app. Jamun, day,
 * marigold, flame, rani, peacock, ink; the night theme lifts the accents.
 * Primary actions wear the marigold-to-flame gradient with dark text, never
 * white. Status never borrows the vibe colours.
 */
object Mela {
    val Jamun = Color(0xFF2A1235)
    val Day = Color(0xFFFFF6EA)
    val Blush = Color(0xFFFFE9DA)
    val Marigold = Color(0xFFFFB31A)
    val Flame = Color(0xFFFF5B2E)
    val Rani = Color(0xFFD9146F)
    val Peacock = Color(0xFF00A19A)
    val Ink = Color(0xFF221428)
    val InkSoft = Color(0xFF5E4B5E)
    val OnBright = Color(0xFF1E0F26)
    val Sindoor = Color(0xFFB80F5E)
    val Cream = Color(0xFFFFF3E6)
    val DimOnDusk = Color(0xFFD2BCD9)
    val NightDay = Color(0xFF1C0B24)
    val NightCard = Color(0xFF2A1532)
    val NightLine = Color(0xFF4A2E52)
    val Grad = Brush.linearGradient(listOf(Marigold, Flame))
    /** Emergency red: SOS and nothing else. */
    val Sos = Color(0xFFC62828)
}

@Composable
fun ParwahTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) darkColorScheme(
        primary = Mela.Marigold, onPrimary = Mela.OnBright,
        secondary = Color(0xFFFF7AB6), onSecondary = Mela.OnBright,
        background = Mela.NightDay, onBackground = Mela.Cream,
        surface = Mela.NightCard, onSurface = Mela.Cream,
        surfaceVariant = Color(0xFF26112F), onSurfaceVariant = Mela.DimOnDusk,
        outline = Mela.NightLine, error = Color(0xFFFF8A80),
    ) else lightColorScheme(
        // On the light ground, marigold text is 1.8:1 and fails AA. Text
        // buttons and links take the rani ink instead, as the website's
        // small emphasis does; the main action keeps the gradient.
        primary = Mela.Sindoor, onPrimary = Color.White,
        secondary = Mela.Sindoor, onSecondary = Color.White,
        background = Mela.Day, onBackground = Mela.Ink,
        surface = Color.White, onSurface = Mela.Ink,
        surfaceVariant = Mela.Blush, onSurfaceVariant = Mela.InkSoft,
        outline = Color(0xFFF0DCC8), error = Mela.Sindoor,
    )
    MaterialTheme(colorScheme = colors, content = content)
}
