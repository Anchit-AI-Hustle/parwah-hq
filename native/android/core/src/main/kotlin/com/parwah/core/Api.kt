package com.parwah.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject

/** One HTTP exchange. The app plugs in a real one; tests plug in a fake. */
fun interface Transport {
    /** [body] null means GET. Returns the status and the raw reply. */
    suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): Pair<Int, String>
}

/** Where the session token lives: the Android Keystore, the iPhone Keychain, or memory in tests. */
interface TokenStore {
    var token: String?
}

class MemoryTokenStore(override var token: String? = null) : TokenStore

/** A reply the server sent, with its status. */
data class Reply(val status: Int, val json: JsonObject) {
    val ok: Boolean get() = (json["ok"] as? JsonPrimitive)?.booleanOrNull == true
    val error: String? get() = (json["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/** The session is over: the person must sign in again. */
class SignedOut(message: String = "Please sign in again") : Exception(message)

/** The network or the server failed; the screen says so and offers to try again. */
class Unreachable(message: String) : Exception(message)

/**
 * The client for the same API the web app uses (the handlers in api/).
 *
 * Every call carries the session token in X-Parwah-Token, never in the
 * address, and the phone's time zone in X-Parwah-Tz, so the family's
 * "today" is their own. A reply that says signin:true, or any 401, means the
 * session has ended: the token is dropped and [SignedOut] is thrown, so the
 * app lands on sign-in instead of a screen of silent failures.
 */
class Api(
    private val base: String,
    private val transport: Transport,
    private val tokens: TokenStore,
    private val timeZone: () -> String,
) {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    suspend fun post(path: String, body: JsonObject): Reply = call("POST", path, body.toString())
    suspend fun get(path: String): Reply = call("GET", path, null)

    private suspend fun call(method: String, path: String, body: String?): Reply {
        val headers = buildMap {
            put("Accept", "application/json")
            if (body != null) put("Content-Type", "application/json")
            tokens.token?.let { put("X-Parwah-Token", it) }
            put("X-Parwah-Tz", timeZone())
        }
        val (status, raw) = try {
            transport.send(method, base.trimEnd('/') + path, headers, body)
        } catch (e: Exception) {
            throw Unreachable("We could not reach Parwah. Please check your internet and try again.")
        }
        val obj: JsonObject = try {
            json.parseToJsonElement(raw).jsonObject
        } catch (e: Exception) {
            if (status == 401) { tokens.token = null; throw SignedOut() }
            throw Unreachable("Something went wrong on our side. Please try again in a minute.")
        }
        val signin = (obj["signin"] as? JsonPrimitive)?.booleanOrNull == true
        if (signin || status == 401 && !isPinRefusal(obj)) {
            tokens.token = null
            throw SignedOut((obj["error"] as? JsonPrimitive)?.content ?: "Please sign in again")
        }
        return Reply(status, obj)
    }

    // A wrong PIN is also a 401, but it is an answer, not a lost session.
    private fun isPinRefusal(o: JsonObject) = (o["wrongPin"] as? JsonPrimitive)?.booleanOrNull == true

    companion object {
        fun obj(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(
            pairs.filter { it.second != null }.associate { (k, v) -> k to elementOf(v) }
        )
        private fun elementOf(v: Any?): JsonElement = when (v) {
            is JsonElement -> v
            is String -> JsonPrimitive(v)
            is Number -> JsonPrimitive(v)
            is Boolean -> JsonPrimitive(v)
            else -> JsonPrimitive(v.toString())
        }
    }
}
