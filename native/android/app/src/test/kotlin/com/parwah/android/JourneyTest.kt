package com.parwah.android

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import com.parwah.core.MemoryTokenStore
import com.parwah.core.Transport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * A person signs in and reaches their family's Today, through the real
 * screens, against a server that answers exactly as api/ does. Screenshots
 * of each step are written to build/journey/ for review.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h844dp-xxhdpi")
class JourneyTest {
    @get:Rule val ui = createComposeRule()

    /** The server, scripted from the replies api/auth.mjs and api/events.mjs give. */
    private class Server : Transport {
        val calls = mutableListOf<String>()
        override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): Pair<Int, String> {
            val b = body ?: ""
            calls += "$method ${url.substringAfter(".com")} $b"
            return when {
                "\"action\":\"enter\"" in b && "\"pin\"" !in b -> 200 to """{"ok":true,"exists":true,"needPin":true}"""
                "\"pin\":\"1111\"" in b -> 401 to """{"ok":false,"wrongPin":true,"left":4,"error":"That PIN is not right. 4 tries left."}"""
                "\"pin\":\"4829\"" in b -> 200 to """{"ok":true,"exists":true,"token":"tok","toured":true,
                    "user":{"id":"u1","name":"Papa","phone":"+919820000001"},
                    "circles":[{"code":"SHARMA","circleName":"Sharma Family","memberId":"m2","role":"parent","memberCount":3,"unread":2}]}"""
                url.contains("/api/events/?") -> 200 to """{"ok":true,"circleName":"Sharma Family","code":"SHARMA","counts":{"docs":12},
                    "members":[{"id":"m1","name":"Rohan","role":"family"},{"id":"m2","name":"Papa","role":"parent"},{"id":"m3","name":"Meera","role":"family"}],
                    "events":[{"id":"e1","type":"checkin","created_at":"2026-10-20T08:00:00Z","member_id":"m3","member_name":"Meera"}],
                    "calls":[],"joinRequests":[],"sos":[]}"""
                "\"type\":\"checkin\"" in b -> 200 to """{"ok":true}"""
                else -> 404 to """{"ok":false,"error":"not scripted"}"""
            }
        }
    }

    private fun shot(name: String) {
        File("build/journey").mkdirs()
        ui.onRoot().captureRoboImage("build/journey/$name.png")
    }

    @Test fun anElderSignsInAndTellsTheFamilyAllIsWell() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        app.getSharedPreferences("parwah", 0).edit().clear().commit()
        val server = Server()
        val model = AppModel(app, server, MemoryTokenStore())
        ui.setContent { ParwahTheme(dark = false) { ParwahApp(model) } }

        ui.onNodeWithText("Mobile number").performTextInput("9820000001")
        shot("1-phone")
        ui.onNodeWithText("Continue").performClick()
        ui.waitUntil(5000) { model.step is Step.Pin }

        ui.onNodeWithText("PIN").performTextInput("1111")
        ui.onNodeWithText("Sign in").performClick()
        ui.waitUntil(5000) { model.message != null }
        ui.onNodeWithText("That PIN is not right. 4 tries left.").assertIsDisplayed()
        shot("2-wrong-pin")

        ui.onNodeWithText("PIN").performTextInput("4829".let { "\b\b\b\b$it" }.takeLast(4))
        model.submitPin("4829")
        ui.waitUntil(5000) { model.step is Step.Circles }
        ui.onNodeWithText("2 new messages").assertIsDisplayed()
        shot("3-families")

        ui.onNodeWithText("Sharma Family").performClick()
        ui.waitUntil(5000) { model.step is Step.Today && model.family != null }
        ui.onNodeWithText("All is well").assertIsDisplayed()
        ui.onNodeWithText("12 papers kept").assertIsDisplayed()
        ui.onNodeWithText("Meera said all is well").assertIsDisplayed()
        shot("4-today-elder")

        ui.onNodeWithText("All is well").performClick()
        ui.waitUntil(5000) { model.message != null }
        ui.onNodeWithText("The family can see you are well.").assertIsDisplayed()
        shot("5-checked-in")

        assertTrue("the check-in reached the server", server.calls.any { "\"type\":\"checkin\"" in it })
        assertEquals("the phone keeps who it is", "Papa", model.user?.name)
    }

    @Test fun aNewPinTheServerWouldRefuseIsRefusedOnThePhoneFirst() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val server = object : Transport {
            var n = 0
            override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?) =
                (200 to """{"ok":true,"exists":false}""").also { n++ }
        }
        val model = AppModel(app, server, MemoryTokenStore())
        ui.setContent { ParwahTheme(dark = true) { ParwahApp(model) } }
        ui.onNodeWithText("Mobile number").performTextInput("9820000009")
        ui.onNodeWithText("Continue").performClick()
        ui.waitUntil(5000) { model.step is Step.Choose }
        val before = server.n
        ui.onNodeWithText("Your name").performTextInput("Asha")
        ui.onNodeWithText("New PIN").performTextInput("1234")
        ui.onNodeWithText("The same PIN again").performTextInput("1234")
        ui.onNodeWithText("Continue").performClick()
        ui.waitUntil(5000) { model.message != null }
        ui.onNodeWithText("That PIN is one of the first anyone would try. Please pick another.").assertIsDisplayed()
        assertEquals("nothing was sent", before, server.n)
        shot("6-choose-pin-dark")
    }
}
