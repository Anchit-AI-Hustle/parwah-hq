package com.parwah.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The phone's PIN rule is the server's, checked against what the server itself wrote. */
class PinTest {
    private val refused = Json.parseToJsonElement(File("../../contract/contract.json").readText())
        .jsonObject["pin"]!!.jsonObject["refused"]!!.jsonObject
        .mapValues { it.value.jsonPrimitive.content }

    @Test fun everyFourNumberPinIsJudgedExactlyAsTheServerJudgesIt() {
        val wrong = (0 until 10000).map { it.toString().padStart(4, '0') }
            .filter { Pin.error(it) != refused[it] }
        assertTrue(wrong.isEmpty(), "differs from the server for ${wrong.take(5)}")
    }

    @Test fun theOtherShapesAreRefusedInTheServersWords() {
        for ((pin, why) in refused.filterKeys { it.length != 4 || !it.all(Char::isDigit) }) {
            assertEquals(why, Pin.error(pin), "for \"$pin\"")
        }
    }

    @Test fun aGoodPinIsAccepted() = assertEquals(null, Pin.error("4829"))
}
