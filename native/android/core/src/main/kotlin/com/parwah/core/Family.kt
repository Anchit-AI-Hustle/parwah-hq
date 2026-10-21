package com.parwah.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import java.net.URLEncoder

@Serializable
data class Member(
    val id: String,
    val name: String,
    val role: String = "family",
    val phone: String? = null,
    val place: String? = null,
    val country: String? = null,
    val relation: String? = null,
    val kin: String? = null,
    val on_app: Boolean = false,
) {
    val isElder: Boolean get() = role == "parent"
    val firstName: String get() = name.trim().substringBefore(' ')
}

@Serializable
data class FamilyEvent(
    val id: String,
    val type: String,
    val text: String? = null,
    val created_at: String,
    val member_id: String? = null,
    val member_name: String? = null,
)

@Serializable
data class LiveCall(val id: String, val room: String, val label: String? = null, val started_at: String, val by_name: String? = null)

@Serializable
data class JoinRequest(val id: String, val name: String, val relation: String? = null, val created_at: String)

@Serializable
data class OpenSos(
    val id: String,
    val member_id: String,
    val status: String,
    val name: String,
    val phone: String? = null,
    val created_at: String,
    val acked_name: String? = null,
    val map: String? = null,
)

/** Everything Today needs, from one GET /api/events. */
data class Family(
    val name: String,
    val code: String,
    val members: List<Member>,
    val events: List<FamilyEvent>,
    val calls: List<LiveCall>,
    val joinRequests: List<JoinRequest>,
    val sos: List<OpenSos>,
    val docs: Int?,
    val seenAt: String?,
) {
    fun member(id: String) = members.firstOrNull { it.id == id }
}

/** Where this phone stands: which family, as which member. Saved between launches. */
@Serializable
data class Seat(val code: String, val circleName: String, val memberId: String, val name: String, val role: String) {
    val isElder: Boolean get() = role == "parent"
}

class FamilyClient(private val api: Api) {
    private fun q(v: String) = URLEncoder.encode(v, "UTF-8")

    suspend fun load(seat: Seat): Family {
        val r = api.get("/api/events/?circle=${q(seat.code)}&member=${q(seat.memberId)}")
        if (!r.ok) throw Unreachable(r.error ?: "Could not load the family. Please try again.")
        val j = r.json
        fun <T> list(k: String, f: (kotlinx.serialization.json.JsonElement) -> T): T? = j[k]?.let(f)
        return Family(
            name = (j["circleName"] as? JsonPrimitive)?.content ?: seat.circleName,
            code = (j["code"] as? JsonPrimitive)?.content ?: seat.code,
            members = list("members") { api.json.decodeFromJsonElement<List<Member>>(it) } ?: emptyList(),
            events = list("events") { api.json.decodeFromJsonElement<List<FamilyEvent>>(it) } ?: emptyList(),
            calls = list("calls") { api.json.decodeFromJsonElement<List<LiveCall>>(it) } ?: emptyList(),
            joinRequests = list("joinRequests") { api.json.decodeFromJsonElement<List<JoinRequest>>(it) } ?: emptyList(),
            sos = list("sos") { api.json.decodeFromJsonElement<List<OpenSos>>(it) } ?: emptyList(),
            docs = (j["counts"]?.jsonObject?.get("docs") as? JsonPrimitive)?.intOrNull,
            seenAt = (j["seenAt"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        )
    }

    /** "All is well" from an elder's big button. */
    suspend fun checkIn(seat: Seat) = event(seat, "checkin")

    /** "Medicines taken" from an elder's big button. */
    suspend fun medicinesTaken(seat: Seat) = event(seat, "pill")

    private suspend fun event(seat: Seat, type: String): Reply {
        val r = api.post("/api/events/", Api.obj("code" to seat.code, "memberId" to seat.memberId, "type" to type))
        if (!r.ok) throw Unreachable(r.error ?: "That did not reach the family. Please try again.")
        return r
    }

    /** Make a family (or a group). 201 with the new code and this person's seat in it. */
    suspend fun create(
        user: User, memberName: String, circleName: String, kind: String = "family",
        familyType: String? = "nuclear", elder: Boolean = false, relation: String = "family",
    ): Seat {
        val r = api.post("/api/circle/", Api.obj(
            "action" to "create", "kind" to kind, "familyType" to if (kind == "family") familyType else null,
            "memberName" to memberName, "circleName" to circleName, "userId" to user.id,
            "role" to if (elder) "parent" else "family", "relation" to relation,
        ))
        if (!r.ok) throw Unreachable(r.error ?: "Could not make the family. Please try again.")
        return seatOf(r, memberName)
    }

    /** Join by code. Pending when the family lets people in by approval. */
    suspend fun join(user: User, code: String, memberName: String, elder: Boolean = false, relation: String = "family"): Joined {
        val clean = code.uppercase().filter { it.isLetterOrDigit() }.take(12)
        val r = api.post("/api/circle/", Api.obj(
            "action" to "join", "code" to clean, "memberName" to memberName, "userId" to user.id,
            "role" to if (elder) "parent" else "family", "relation" to relation,
        ))
        if (!r.ok) return Joined.Refused(r.error ?: "Could not join. Please check the code and try again.")
        if ((r.json["pending"] as? JsonPrimitive)?.content == "true") {
            return Joined.Waiting((r.json["circleName"] as? JsonPrimitive)?.content ?: clean,
                (r.json["message"] as? JsonPrimitive)?.content ?: "Your request has gone to the family.")
        }
        return Joined.In(seatOf(r, memberName))
    }

    private fun seatOf(r: Reply, memberName: String) = Seat(
        code = (r.json["code"] as JsonPrimitive).content,
        circleName = (r.json["circleName"] as? JsonPrimitive)?.content ?: "",
        memberId = (r.json["memberId"] as JsonPrimitive).content,
        name = memberName,
        role = (r.json["role"] as? JsonPrimitive)?.content ?: "family",
    )
}

sealed interface Joined {
    data class In(val seat: Seat) : Joined
    data class Waiting(val circleName: String, val message: String) : Joined
    data class Refused(val error: String) : Joined
}

/** A circle from the sign-in list, as the seat this phone takes in it. */
fun Circle.seat(personName: String) = Seat(code, circleName, memberId, memberName ?: personName, role)
