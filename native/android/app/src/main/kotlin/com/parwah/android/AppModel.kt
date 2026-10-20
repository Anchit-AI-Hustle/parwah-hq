package com.parwah.android

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.parwah.core.Api
import com.parwah.core.AuthClient
import com.parwah.core.Circle
import com.parwah.core.Enter
import com.parwah.core.Family
import com.parwah.core.FamilyClient
import com.parwah.core.Joined
import com.parwah.core.Pin
import com.parwah.core.Seat
import com.parwah.core.TokenStore
import com.parwah.core.Transport
import com.parwah.core.SignedOut
import com.parwah.core.Unreachable
import com.parwah.core.User
import com.parwah.core.seat
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.TimeZone

/** Where the person is. One screen at a time, like the web app's steps. */
sealed interface Step {
    data object Starting : Step
    data object Phone : Step
    data class Pin(val older: Boolean) : Step
    /** A new number, or an account with no PIN: choose one (and a name when new). */
    data class Choose(val needName: Boolean, val replacing: Boolean = false) : Step
    data class Circles(val circles: List<Circle>) : Step
    data object Setup : Step
    data class Waiting(val circleName: String, val message: String) : Step
    data class Today(val seat: Seat) : Step
}

class AppModel(
    app: Application,
    transport: Transport,
    private val tokens: TokenStore,
) : AndroidViewModel(app) {
    /** The real phone: HTTPS to the live server, the token in the Keystore. */
    constructor(app: Application) : this(app, HttpTransport(), KeystoreTokenStore(app))

    private val remembered = Remembered(app)
    private val api = Api(BASE_URL, transport, tokens) { TimeZone.getDefault().id }
    private val auth = AuthClient(api, tokens)
    private val families = FamilyClient(api)

    var step by mutableStateOf<Step>(Step.Starting); private set
    var busy by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null); private set
    var family by mutableStateOf<Family?>(null); private set
    var phone by mutableStateOf(""); private set
    var cc by mutableStateOf(remembered.cc); private set
    private var oldSecret: String? = null
    private var poll: Job? = null

    val user: User? get() = remembered.user

    init { boot() }

    /** Same order as the web app's boot: a family on this phone, then an account, then sign-in. */
    private fun boot() = viewModelScope.launch {
        val u = remembered.user
        val s = remembered.seat
        when {
            u != null && s != null && tokens.token != null -> openFamily(s)
            u != null && tokens.token != null -> refreshCircles(u)
            else -> step = Step.Phone
        }
    }

    private suspend fun refreshCircles(u: User) {
        phone = u.phone?.removePrefix(cc) ?: ""
        handle(auth.refresh(u.phone ?: "", cc))
    }

    fun submitPhone(number: String, code: String) = act {
        phone = number.filter { it.isDigit() }
        cc = code
        remembered.cc = code
        if (phone.length < 6) { message = "Please check the number. It looks too short."; return@act }
        handle(auth.enter(phone, cc))
    }

    // Kept for one step only: an older secret that checks out must be sent
    // again with the new PIN that replaces it.
    fun submitPin(pin: String) = act { oldSecret = pin; handle(auth.enter(phone, cc, pin = pin)) }

    /** Choosing a PIN: checked on the phone with the server's own rule first. */
    fun choosePin(name: String?, pin: String, again: String) = act {
        Pin.error(pin)?.let { message = it; return@act }
        if (pin != again) { message = "The two PINs are not the same. Please type it again."; return@act }
        val s = step
        val r = if (s is Step.Choose && s.replacing) auth.enter(phone, cc, pin = oldSecret, newPin = pin)
                else auth.enter(phone, cc, name = name?.trim()?.ifEmpty { null }, pin = pin)
        handle(r)
    }

    private fun handle(r: Enter) {
        message = null
        when (r) {
            is Enter.NewNumber -> { step = Step.Choose(needName = true); message = r.error }
            is Enter.AskPin -> step = Step.Pin(r.older)
            is Enter.ChoosePin -> { step = Step.Choose(needName = false); message = r.error }
            is Enter.ReplaceSecret -> { step = Step.Choose(needName = false, replacing = true); message = r.error ?: "Please choose a new 4-number PIN." }
            is Enter.WrongPin -> message = r.error
            is Enter.Locked -> message = r.error
            is Enter.Refused -> message = r.error
            is Enter.In -> {
                oldSecret = null
                remembered.user = r.user
                step = if (r.circles.isEmpty()) Step.Setup else Step.Circles(r.circles)
            }
        }
    }

    fun pick(c: Circle) = act { openFamily(c.seat(user?.name ?: "")) }

    fun startSetup() { message = null; step = Step.Setup }

    fun create(memberName: String, circleName: String, elder: Boolean) = act {
        val u = user ?: return@act
        if (circleName.isBlank()) { message = "Please give the family a name."; return@act }
        openFamily(families.create(u, memberName.ifBlank { u.name }, circleName.trim(), elder = elder))
    }

    fun join(code: String, memberName: String, elder: Boolean) = act {
        val u = user ?: return@act
        when (val j = families.join(u, code, memberName.ifBlank { u.name }, elder = elder)) {
            is Joined.In -> openFamily(j.seat)
            is Joined.Waiting -> step = Step.Waiting(j.circleName, j.message)
            is Joined.Refused -> message = j.error
        }
    }

    fun backToCircles() = act { poll?.cancel(); remembered.seat = null; family = null; user?.let { refreshCircles(it) } }

    private suspend fun openFamily(seat: Seat) {
        remembered.seat = seat
        family = families.load(seat)
        step = Step.Today(seat)
        poll?.cancel()
        // The web app looks every 12 seconds while it is open; so does this.
        poll = viewModelScope.launch {
            while (isActive) {
                delay(12_000)
                try { family = families.load(seat) } catch (e: SignedOut) { signedOut(e.message); break } catch (e: Exception) {}
            }
        }
    }

    fun checkIn() = act { (step as? Step.Today)?.seat?.let { families.checkIn(it); message = "The family can see you are well."; reload(it) } }
    fun medicinesTaken() = act { (step as? Step.Today)?.seat?.let { families.medicinesTaken(it); message = "Noted. The family can see it."; reload(it) } }
    private suspend fun reload(seat: Seat) { family = families.load(seat) }

    fun signOut() = act { poll?.cancel(); auth.signOut(); remembered.clear(); family = null; step = Step.Phone }

    fun dismissMessage() { message = null }

    private fun signedOut(why: String?) {
        poll?.cancel(); remembered.seat = null; family = null
        step = Step.Phone; message = why ?: "Please sign in again."
    }

    /** One action at a time: a second tap while the first is on its way does nothing. */
    private fun act(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try { block() }
            catch (e: SignedOut) { signedOut(e.message) }
            catch (e: Unreachable) { message = e.message }
            catch (e: Exception) { message = "Something went wrong. Please try again." }
            finally { busy = false }
        }
    }

    companion object { const val BASE_URL = "https://parwah-hq.anchit-tandon.com" }
}
