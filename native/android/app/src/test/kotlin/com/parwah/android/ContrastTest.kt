package com.parwah.android

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Every text pair the screens use passes WCAG AA (4.5:1), in both themes, as on the website. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ContrastTest {
    @get:Rule val ui = createComposeRule()

    private fun ratio(a: Color, b: Color): Double {
        val x = a.luminance() + 0.05; val y = b.luminance() + 0.05
        return (maxOf(x, y) / minOf(x, y)).toDouble()
    }

    @Test fun everyTextPairPassesInBothThemes() {
        val schemes = mutableMapOf<String, ColorScheme>()
        ui.setContent {
            ParwahTheme(dark = false) { schemes["light"] = MaterialTheme.colorScheme }
            ParwahTheme(dark = true) { schemes["dark"] = MaterialTheme.colorScheme }
        }
        ui.waitForIdle()
        val bad = mutableListOf<String>()
        for ((name, c) in schemes) {
            val pairs = mapOf(
                "text on the ground" to (c.onBackground to c.background),
                "text on a card" to (c.onSurface to c.surface),
                "quiet text on the ground" to (c.onSurfaceVariant to c.background),
                "quiet text on a card" to (c.onSurfaceVariant to c.surface),
                "a text button or link" to (c.primary to c.background),
                "a message box" to (c.onSurface to c.surfaceVariant),
            )
            pairs.forEach { (what, p) -> val r = ratio(p.first, p.second); if (r < 4.5) bad += "$name: $what is ${"%.2f".format(r)}:1" }
        }
        // The main action: dark text on the gradient, checked at both ends.
        listOf(Mela.Marigold, Mela.Flame).forEach { if (ratio(Mela.OnBright, it) < 4.5) bad += "the main button on $it" }
        // SOS: white on emergency red.
        if (ratio(Color.White, Mela.Sos) < 4.5) bad += "SOS"
        assertTrue(bad.joinToString("; "), bad.isEmpty())
    }
}
