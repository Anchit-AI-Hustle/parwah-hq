package com.parwah.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull

@Serializable
data class User(val id: String, val name: String, val phone: String? = null)

/** One family or group this person belongs to, as the circle list shows it. */
@Serializable
data class Circle(
    val code: String,
    val circleName: String,
    val kind: String = "family",
    val memberId: String,
    val role: String = "family",
    val memberName: String? = null,
    val memberCount: Int = 0,
    val unread: Int = 0,
    val openRequests: Int = 0,
    val waiting: Int = 0,
    val live: Int = 0,
    val lastAt: String? = null,
    val lastText: String? = null,
    val lastType: String? = null,
) {
    val isElder: Boolean get() = role == "parent"
}

/**
 * Every answer the sign-in step can give (api/auth.mjs, action 'enter'), as
 * the screens need them: which box to show next, and what to say.
 */
sealed interface Enter {
    /** A number Parwah has not seen: ask for a name and a new PIN. */
    data class NewNumber(val error: String? = null) : Enter
    /** A known number: ask for the PIN. [older] = a secret from before 4-number PINs, up to 64 characters. */
    data class AskPin(val older: Boolean) : Enter
    /** A known account with no PIN yet: ask them to choose one. */
    data class ChoosePin(val error: String? = null) : Enter
    /** An older secret checked out: a 4-number PIN must be chosen before going on. */
    data class ReplaceSecret(val name: String?, val error: String? = null) : Enter
    data class WrongPin(val left: Int?, val error: String) : Enter
    data class Locked(val error: String) : Enter
    data class In(val user: User, val circles: List<Circle>, val toured: Boolean) : Enter
    data class Refused(val error: String) : Enter
}

class AuthClient(private val api: Api, private val tokens: TokenStore) {

    /**
     * Sign in, or sign up, in one step, exactly as the web app does.
     * [newPin] only when replacing an older secret.
     */
    suspend fun enter(
        phone: String, cc: String = "+91", name: String? = null,
        pin: String? = null, newPin: String? = null, device: String = "android",
    ): Enter {
        val r = api.post("/api/auth/", Api.obj(
            "action" to "enter", "phone" to phone, "cc" to cc, "name" to name,
            "pin" to pin, "newPin" to newPin, "device" to device,
        ))
        return read(r)
    }

    /** The circle list again, for a person already signed in. Issues no new token. */
    suspend fun refresh(phone: String, cc: String = "+91"): Enter =
        read(api.post("/api/auth/", Api.obj("action" to "enter", "phone" to phone, "cc" to cc, "refresh" to true)))

    suspend fun signOut() {
        val t = tokens.token
        try { api.post("/api/auth/", Api.obj("action" to "signout", "token" to t)) } catch (e: Exception) {}
        tokens.token = null
    }

    private fun flag(r: Reply, k: String) = (r.json[k] as? JsonPrimitive)?.booleanOrNull == true

    internal fun read(r: Reply): Enter {
        val err = r.error
        if (flag(r, "locked")) return Enter.Locked(err ?: "Too many tries. Please wait 15 minutes.")
        if (flag(r, "wrongPin")) return Enter.WrongPin((r.json["left"] as? JsonPrimitive)?.intOrNull, err ?: "That PIN is not right.")
        if (!r.ok) return Enter.Refused(err ?: "Something went wrong on our side. Please try again in a minute.")
        val exists = flag(r, "exists")
        if (!exists) return Enter.NewNumber(err)
        if (flag(r, "changeSecret")) return Enter.ReplaceSecret((r.json["name"] as? JsonPrimitive)?.content, err)
        if (flag(r, "setPin")) return Enter.ChoosePin(err)
        val userEl = r.json["user"]
        if (flag(r, "needPin") || userEl == null) return Enter.AskPin(flag(r, "older"))
        (r.json["token"] as? JsonPrimitive)?.content?.let { tokens.token = it }
        val user = api.json.decodeFromJsonElement<User>(userEl)
        val circles = r.json["circles"]?.let { api.json.decodeFromJsonElement<List<Circle>>(it) } ?: emptyList()
        // The circle list is shown busiest first, as on the web: a live call,
        // someone waiting to be let in, unread messages, open requests.
        val sorted = circles.sortedWith(compareByDescending<Circle> { it.live }
            .thenByDescending { it.waiting }.thenByDescending { it.unread }.thenByDescending { it.openRequests })
        return Enter.In(user, sorted, flag(r, "toured"))
    }
}
