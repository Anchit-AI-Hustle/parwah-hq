package com.parwah.core

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Every answer the server's sign-in step gives, read the way the screens need it. */
class AuthTest {
    private class Fake(var status: Int = 200, var reply: String = "{}") : Transport {
        val sent = mutableListOf<Triple<String, Map<String, String>, String?>>()
        override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): Pair<Int, String> {
            sent += Triple("$method $url", headers, body); return status to reply
        }
    }
    private val tokens = MemoryTokenStore()
    private val fake = Fake()
    private val api = Api("https://parwah.test/", fake, tokens) { "Asia/Kolkata" }
    private val auth = AuthClient(api, tokens)
    private fun answer(status: Int, json: String) { fake.status = status; fake.reply = json }

    @Test fun anUnknownNumberAsksForANameAndAPin() = runTest {
        answer(200, """{"ok":true,"exists":false}""")
        assertIs<Enter.NewNumber>(auth.enter("9820000001"))
    }

    @Test fun aKnownNumberAsksForThePinAndSaysWhenTheSecretIsOlder() = runTest {
        answer(200, """{"ok":true,"exists":true,"needPin":true,"older":true}""")
        assertEquals(Enter.AskPin(older = true), auth.enter("9820000001"))
    }

    @Test fun anAccountWithNoPinIsAskedToChooseOne() = runTest {
        answer(200, """{"ok":true,"exists":true,"setPin":true}""")
        assertIs<Enter.ChoosePin>(auth.enter("9820000001"))
    }

    @Test fun anOlderSecretMustBeReplacedBeforeGoingOn() = runTest {
        answer(200, """{"ok":true,"exists":true,"changeSecret":true,"name":"Asha"}""")
        assertEquals("Asha", (auth.enter("9820000001", pin = "old-password") as Enter.ReplaceSecret).name)
    }

    @Test fun aWrongPinSaysHowManyTriesAreLeftAndKeepsNoSession() = runTest {
        tokens.token = null
        answer(401, """{"ok":false,"wrongPin":true,"left":3,"error":"That PIN is not right. 3 tries left."}""")
        val r = auth.enter("9820000001", pin = "4829")
        assertEquals(Enter.WrongPin(3, "That PIN is not right. 3 tries left."), r)
    }

    @Test fun aLockedNumberSaysSo() = runTest {
        answer(429, """{"ok":false,"locked":true,"error":"Locked for 15 minutes."}""")
        assertEquals(Enter.Locked("Locked for 15 minutes."), auth.enter("9820000001", pin = "4829"))
    }

    @Test fun signingInKeepsTheTokenAndListsTheBusiestFamilyFirst() = runTest {
        answer(200, """{"ok":true,"exists":true,"token":"tok123","toured":true,
          "user":{"id":"u1","name":"Asha","phone":"+919820000001"},
          "circles":[{"code":"QUIET","circleName":"Quiet","memberId":"m1"},
                     {"code":"BUSY","circleName":"Busy","memberId":"m2","unread":4},
                     {"code":"LIVE","circleName":"Live","memberId":"m3","live":1,"role":"parent"}],
          "pinResets":[]}""")
        val r = assertIs<Enter.In>(auth.enter("9820000001", pin = "4829"))
        assertEquals("tok123", tokens.token)
        assertEquals(listOf("LIVE", "BUSY", "QUIET"), r.circles.map { it.code })
        assertTrue(r.circles.first().isElder)
        assertEquals("Asha", r.user.name)
    }

    @Test fun everyCallCarriesTheTokenInAHeaderAndTheTimeZone() = runTest {
        tokens.token = "tok123"
        answer(200, """{"ok":true,"exists":true,"needPin":true}""")
        auth.enter("9820000001")
        val (line, headers, body) = fake.sent.last()
        assertEquals("POST https://parwah.test/api/auth/", line)
        assertEquals("tok123", headers["X-Parwah-Token"])
        assertEquals("Asia/Kolkata", headers["X-Parwah-Tz"])
        assertTrue(body!!.contains("\"action\":\"enter\"") && !body.contains("tok123"), "the token never rides in the body")
    }

    @Test fun anEndedSessionDropsTheTokenAndSaysSignIn() = runTest {
        tokens.token = "stale"
        answer(401, """{"ok":false,"signin":true,"error":"Please sign in again"}""")
        assertFailsWith<SignedOut> { api.get("/api/events/?circle=X&member=Y") }
        assertNull(tokens.token)
    }

    @Test fun aPlain401IsAnEndedSessionToo() = runTest {
        tokens.token = "stale"
        answer(401, """{"ok":false,"error":"Not a member"}""")
        assertFailsWith<SignedOut> { api.get("/api/care/?circle=X&member=Y") }
        assertNull(tokens.token)
    }

    @Test fun aServerThatAnswersWithAnHtmlErrorPageIsSaidPlainly() = runTest {
        answer(500, "<html>oops</html>")
        val e = assertFailsWith<Unreachable> { api.get("/api/events/") }
        assertTrue(e.message!!.contains("on our side"))
    }

    @Test fun noNetworkIsSaidPlainly() = runTest {
        val dead = Api("https://parwah.test", { _, _, _, _ -> throw java.io.IOException("offline") }, tokens) { "UTC" }
        val e = assertFailsWith<Unreachable> { dead.get("/api/events/") }
        assertTrue(e.message!!.contains("check your internet"))
    }

    @Test fun signingOutForgetsTheTokenEvenWhenTheServerCannotBeReached() = runTest {
        tokens.token = "tok123"
        val dead = Api("https://parwah.test", { _, _, _, _ -> throw java.io.IOException("offline") }, tokens) { "UTC" }
        AuthClient(dead, tokens).signOut()
        assertNull(tokens.token)
    }
}
