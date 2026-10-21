package com.parwah.core

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class FamilyTest {
    private class Fake(var status: Int = 200, var reply: String = "{}") : Transport {
        var last: Pair<String, String?>? = null
        override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): Pair<Int, String> {
            last = "$method $url" to body; return status to reply
        }
    }
    private val fake = Fake()
    private val client = FamilyClient(Api("https://parwah.test", fake, MemoryTokenStore("t")) { "Asia/Kolkata" })
    private val seat = Seat("SHARMA", "Sharma Family", "m1", "Rohan", "family")

    @Test fun todayIsReadFromTheSameReplyTheWebAppReads() = runTest {
        fake.reply = """{"ok":true,"circleName":"Sharma Family","code":"SHARMA","counts":{"docs":12},
          "members":[{"id":"m1","name":"Rohan Sharma","role":"family","relation":"son","on_app":true,"gift_info":{}},
                     {"id":"m2","name":"Papa","role":"parent","kin":"Father"}],
          "events":[{"id":"e1","type":"checkin","text":"","created_at":"2026-10-20T08:00:00Z","member_id":"m2","member_name":"Papa"}],
          "calls":[],"joinRequests":[{"id":"j1","name":"Meera","created_at":"2026-10-20T07:00:00Z"}],
          "sos":[],"seenAt":null,"pulse":null,"findme":null}"""
        val f = client.load(seat)
        assertEquals("GET https://parwah.test/api/events/?circle=SHARMA&member=m1", fake.last!!.first)
        assertEquals(12, f.docs)
        assertTrue(f.member("m2")!!.isElder)
        assertEquals("Father", f.member("m2")!!.kin)
        assertEquals("Rohan", f.member("m1")!!.firstName)
        assertEquals("checkin", f.events.single().type)
        assertEquals("Meera", f.joinRequests.single().name)
    }

    @Test fun anEldersButtonsSendWhatTheWebSends() = runTest {
        fake.reply = """{"ok":true}"""
        client.checkIn(seat)
        assertTrue(fake.last!!.second!!.contains("\"type\":\"checkin\""))
        client.medicinesTaken(seat)
        assertTrue(fake.last!!.second!!.contains("\"type\":\"pill\""))
    }

    @Test fun aCodeIsCleanedBeforeItIsSent() = runTest {
        fake.reply = """{"ok":true,"code":"SHARMA","circleName":"Sharma Family","memberId":"m9","role":"family"}"""
        val j = client.join(User("u1", "Meera"), " sharma-1 ", "Meera")
        assertTrue(fake.last!!.second!!.contains("\"code\":\"SHARMA1\""))
        assertIs<Joined.In>(j)
    }

    @Test fun aFamilyThatApprovesSaysYouAreWaiting() = runTest {
        fake.status = 202
        fake.reply = """{"ok":true,"pending":true,"circleName":"Sharma Family","code":"SHARMA","requestId":"r1","message":"Your request has gone to Sharma Family."}"""
        val j = assertIs<Joined.Waiting>(client.join(User("u1", "Meera"), "SHARMA", "Meera"))
        assertEquals("Your request has gone to Sharma Family.", j.message)
    }

    @Test fun anElderIsMadeAnElder() = runTest {
        fake.status = 201
        fake.reply = """{"ok":true,"code":"NEWFAM","circleName":"Rao","memberId":"m1","role":"parent"}"""
        val s = client.create(User("u1", "Asha"), "Asha", "Rao", elder = true)
        assertTrue(fake.last!!.second!!.contains("\"role\":\"parent\""))
        assertTrue(s.isElder)
    }
}
