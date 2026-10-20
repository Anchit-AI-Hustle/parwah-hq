package com.parwah.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parwah.core.Family
import com.parwah.core.FamilyEvent
import com.parwah.core.Seat

@Composable
fun ParwahApp(m: AppModel) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.safeDrawingPadding().imePadding()) {
            when (val s = m.step) {
                Step.Starting -> Centered { CircularProgressIndicator() }
                Step.Phone -> PhoneScreen(m)
                is Step.Pin -> PinScreen(m, s.older)
                is Step.Choose -> ChooseScreen(m, s)
                is Step.Circles -> CirclesScreen(m, s)
                Step.Setup -> SetupScreen(m)
                is Step.Waiting -> WaitingScreen(m, s)
                is Step.Today -> TodayScreen(m, s.seat, m.family)
            }
        }
    }
}

// ---- building blocks, from the design system's atoms

@Composable private fun Centered(content: @Composable () -> Unit) =
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }

/** A form screen: one column, readable width on a tablet, scrolls on a small phone. */
@Composable private fun Page(title: String, sub: String? = null, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 560.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("परवाह  Parwah", color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
            Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.semantics { heading() })
            if (sub != null) Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 16.sp)
            content()
        }
    }
}

/** The primary action: the marigold-to-flame gradient with dark text, never white. */
@Composable fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(999.dp))
            .background(if (enabled) Mela.Grad else androidx.compose.ui.graphics.SolidColor(Color(0x66FFB31A)))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Mela.OnBright, fontWeight = FontWeight.Bold, fontSize = 17.sp) }
}

/** What happened, in a plain sentence, read out by TalkBack when it changes. */
@Composable private fun Message(m: AppModel) {
    val msg = m.message ?: return
    Text(msg, color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant).padding(14.dp)
            .semantics { liveRegion = LiveRegionMode.Polite })
}

// ---- sign in

@Composable private fun PhoneScreen(m: AppModel) {
    var number by remember { mutableStateOf(m.phone) }
    var code by remember { mutableStateOf(m.cc) }
    Page("Your family, in one safe place.", "Sign in or start with your mobile number.") {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(code, { code = it.filter { c -> c.isDigit() || c == '+' }.take(5) }, label = { Text("Code") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.widthIn(max = 96.dp))
            OutlinedTextField(number, { number = it.filter { c -> c.isDigit() || c == ' ' }.take(16) }, label = { Text("Mobile number") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
        }
        Message(m)
        PrimaryButton(if (m.busy) "Checking..." else "Continue", !m.busy) { m.submitPhone(number, code) }
    }
}

@Composable private fun PinScreen(m: AppModel, older: Boolean) {
    var pin by remember { mutableStateOf("") }
    Page("Welcome back.", if (older) "Type the PIN or password you chose before." else "Type your 4-number PIN.") {
        OutlinedTextField(pin, { pin = if (older) it.take(64) else it.filter(Char::isDigit).take(4) },
            label = { Text(if (older) "PIN or password" else "PIN") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = if (older) KeyboardType.Password else KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth())
        Message(m)
        PrimaryButton(if (m.busy) "Signing in..." else "Sign in", !m.busy && pin.isNotEmpty()) { m.submitPin(pin) }
    }
}

@Composable private fun ChooseScreen(m: AppModel, s: Step.Choose) {
    var name by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    Page(if (s.needName) "Welcome to Parwah." else "Choose a PIN.",
        "A 4-number PIN keeps your family's papers safe. Pick one nobody would guess.") {
        if (s.needName) OutlinedTextField(name, { name = it.take(60) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(pin, { pin = it.filter(Char::isDigit).take(4) }, label = { Text("New PIN") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(again, { again = it.filter(Char::isDigit).take(4) }, label = { Text("The same PIN again") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
        Message(m)
        PrimaryButton(if (m.busy) "Saving..." else "Continue", !m.busy) { m.choosePin(if (s.needName) name else null, pin, again) }
    }
}

// ---- families

@Composable private fun CirclesScreen(m: AppModel, s: Step.Circles) {
    Page("Your families", "Pick one to open.") {
        s.circles.forEach { c ->
            Card(onClick = { m.pick(c) }, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(18.dp)) {
                    Text(c.circleName, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    val bits = listOfNotNull(
                        if (c.live > 0) "a call is on now" else null,
                        if (c.waiting > 0) "${c.waiting} waiting to join" else null,
                        if (c.unread > 0) "${c.unread} new messages" else null,
                        if (c.openRequests > 0) "${c.openRequests} open requests" else null,
                    )
                    Text(if (bits.isEmpty()) "${c.memberCount} people" else bits.joinToString(" · "),
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Message(m)
        OutlinedButton({ m.startSetup() }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Start or join another family") }
        TextButton({ m.signOut() }, Modifier.heightIn(min = 48.dp)) { Text("Sign out") }
    }
}

@Composable private fun SetupScreen(m: AppModel) {
    var joining by remember { mutableStateOf(false) }
    var circleName by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var me by remember { mutableStateOf(m.user?.name ?: "") }
    var elder by remember { mutableStateOf(false) }
    Page(if (joining) "Join your family" else "Start your family",
        if (joining) "Type the code someone in the family shared with you." else "Give it a name everyone will recognise.") {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton({ joining = false }, Modifier.heightIn(min = 48.dp)) { Text(if (!joining) "✓ Start one" else "Start one") }
            OutlinedButton({ joining = true }, Modifier.heightIn(min = 48.dp)) { Text(if (joining) "✓ Join with a code" else "Join with a code") }
        }
        if (joining) OutlinedTextField(code, { code = it.uppercase().filter(Char::isLetterOrDigit).take(12) }, label = { Text("Family code") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        else OutlinedTextField(circleName, { circleName = it.take(60) }, label = { Text("Family name, for example Sharma Family") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(me, { me = it.take(60) }, label = { Text("Your name in the family") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 48.dp).clickable { elder = !elder }) {
            Checkbox(elder, { elder = it })
            Text("I am an elder in this family (bigger buttons, simpler screens)")
        }
        Message(m)
        PrimaryButton(if (m.busy) "Please wait..." else if (joining) "Join" else "Start the family", !m.busy) {
            if (joining) m.join(code, me, elder) else m.create(me, circleName, elder)
        }
    }
}

@Composable private fun WaitingScreen(m: AppModel, s: Step.Waiting) {
    Page("Waiting to be let in", s.message) {
        Text("Anyone already in ${s.circleName} can let you in. You will see the family here as soon as they do.")
        Message(m)
        OutlinedButton({ m.backToCircles() }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Check again") }
    }
}

// ---- Today

@Composable private fun TodayScreen(m: AppModel, seat: Seat, f: Family?) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(f?.name ?: seat.circleName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold,
                            modifier = Modifier.semantics { heading() })
                        Text("Today", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton({ m.backToCircles() }, Modifier.heightIn(min = 48.dp)) { Text("Families") }
                }
            }
        }
        if (seat.isElder) item {
            // An elder's three big buttons come first, as on the web.
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton(if (m.busy) "Sending..." else "All is well", !m.busy) { m.checkIn() }
                OutlinedButton({ m.medicinesTaken() }, Modifier.fillMaxWidth().heightIn(min = 56.dp), enabled = !m.busy) {
                    Text("Medicines taken", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
        item { Box(Modifier.widthIn(max = 720.dp).fillMaxWidth()) { Message(m) } }
        if (f == null) item { CircularProgressIndicator() } else {
            if (f.sos.isNotEmpty()) item {
                Card(Modifier.widthIn(max = 720.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Mela.Sos)) {
                    Text("SOS from ${f.sos.first().name}. Open the family to help.", color = Color.White,
                        fontWeight = FontWeight.Bold, modifier = Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Assertive })
                }
            }
            item {
                Row(Modifier.widthIn(max = 720.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Tile("Family", "${f.members.size} people", Modifier.weight(1f))
                    Tile("Vault", f.docs?.let { if (it == 1) "1 paper kept" else "$it papers kept" } ?: "Papers, kept safe", Modifier.weight(1f))
                }
            }
            if (f.joinRequests.isNotEmpty()) item {
                Tile("Waiting to join", f.joinRequests.joinToString { it.name }, Modifier.widthIn(max = 720.dp).fillMaxWidth())
            }
            item { Text("What happened", fontWeight = FontWeight.Bold, fontSize = 18.sp,
                modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().semantics { heading() }) }
            if (f.events.isEmpty()) item { Text("Nothing yet today. When someone checks in, it shows here.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(f.events.take(30), key = { it.id }) { e -> EventRow(e, Modifier.widthIn(max = 720.dp).fillMaxWidth()) }
            item { TextButton({ m.signOut() }, Modifier.heightIn(min = 48.dp)) { Text("Sign out") } }
        }
    }
}

@Composable private fun Tile(title: String, value: String, modifier: Modifier) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
            Text(value, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
    }
}

@Composable private fun EventRow(e: FamilyEvent, modifier: Modifier) {
    val who = e.member_name ?: "Someone"
    val what = when (e.type) {
        "checkin" -> "$who said all is well"
        "pill" -> "$who took their medicines"
        "sos" -> "$who sent an SOS"
        "join" -> "$who joined the family"
        else -> listOf(who, e.text.orEmpty()).filter { it.isNotBlank() }.joinToString(": ")
    }
    Row(modifier.heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(RoundedCornerShape(5.dp)).background(Mela.Marigold))
        Spacer(Modifier.size(12.dp))
        Column {
            Text(what, fontSize = 16.sp)
            Text(Time.ago(e.created_at), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        }
    }
}
