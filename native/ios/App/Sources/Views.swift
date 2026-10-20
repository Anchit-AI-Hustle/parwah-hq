import SwiftUI
import ParwahCore

struct RootView: View {
    @ObservedObject var model: AppModel
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette.of(scheme)
        ZStack {
            p.ground.ignoresSafeArea()
            switch model.step {
            case .starting: ProgressView()
            case .phone: PhoneView(model: model)
            case .pin(let older): PinView(model: model, older: older)
            case .choose(let needName, _): ChooseView(model: model, needName: needName)
            case .circles(let c): CirclesView(model: model, circles: c)
            case .setup: SetupView(model: model)
            case .waiting(let name, let msg): WaitingView(model: model, circleName: name, message: msg)
            case .today(let seat): TodayView(model: model, seat: seat)
            }
        }
        .tint(p.link)
        .foregroundStyle(p.text)
    }
}

// ---- building blocks

/// A form screen: one column, readable width on an iPad, scrolls on a small phone.
struct Page<Content: View>: View {
    let title: String
    var sub: String? = nil
    @ViewBuilder let content: Content
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette.of(scheme)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("परवाह  Parwah").font(.headline.weight(.heavy)).foregroundStyle(p.link)
                Text(title).font(.largeTitle.weight(.heavy)).accessibilityAddTraits(.isHeader)
                if let sub { Text(sub).font(.body).foregroundStyle(p.soft) }
                content
            }
            .padding(24)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

/// The primary action: the marigold-to-flame gradient with dark text, never white.
struct PrimaryButton: View {
    let title: String
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.headline).foregroundStyle(Mela.onBright)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Mela.grad.opacity(enabled ? 1 : 0.45), in: Capsule())
        }
        .disabled(!enabled)
        .accessibilityIdentifier(title)
    }
}

/// What happened, in a plain sentence, announced by VoiceOver when it changes.
struct MessageView: View {
    @ObservedObject var model: AppModel
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        if let m = model.message {
            Text(m).font(.body).frame(maxWidth: .infinity, alignment: .leading).padding(14)
                .background(Palette.of(scheme).quiet, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("message")
                .onAppear { UIAccessibility.post(notification: .announcement, argument: m) }
        }
    }
}

struct Field: View {
    let label: String
    @Binding var text: String
    var secure = false
    var keyboard: UIKeyboardType = .default
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold))
            Group {
                if secure { SecureField(label, text: $text) } else { TextField(label, text: $text) }
            }
            .keyboardType(keyboard)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(.horizontal, 14).frame(minHeight: 48)
            .background(Palette.of(scheme).card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0xF0DCC8).opacity(0.6)))
            .accessibilityIdentifier(label)
        }
    }
}

// ---- sign in

struct PhoneView: View {
    @ObservedObject var model: AppModel
    @State private var number = ""
    @State private var code = "+91"
    var body: some View {
        Page(title: "Your family, in one safe place.", sub: "Sign in or start with your mobile number.") {
            HStack(alignment: .bottom, spacing: 12) {
                Field(label: "Code", text: $code, keyboard: .phonePad).frame(maxWidth: 96)
                Field(label: "Mobile number", text: $number, keyboard: .phonePad)
            }
            MessageView(model: model)
            PrimaryButton(title: model.busy ? "Checking..." : "Continue", enabled: !model.busy) {
                Task { await model.submitPhone(number, cc: code) }
            }
        }
        .onAppear { number = model.phone; code = model.cc }
    }
}

struct PinView: View {
    @ObservedObject var model: AppModel
    let older: Bool
    @State private var pin = ""
    var body: some View {
        Page(title: "Welcome back.", sub: older ? "Type the PIN or password you chose before." : "Type your 4-number PIN.") {
            Field(label: older ? "PIN or password" : "PIN", text: $pin, secure: true, keyboard: older ? .default : .numberPad)
                .onChange(of: pin) { v in if !older { pin = String(v.filter(\.isNumber).prefix(4)) } }
            MessageView(model: model)
            PrimaryButton(title: model.busy ? "Signing in..." : "Sign in", enabled: !model.busy && !pin.isEmpty) {
                Task { await model.submitPin(pin) }
            }
        }
    }
}

struct ChooseView: View {
    @ObservedObject var model: AppModel
    let needName: Bool
    @State private var name = ""
    @State private var pin = ""
    @State private var again = ""
    var body: some View {
        Page(title: needName ? "Welcome to Parwah." : "Choose a PIN.",
             sub: "A 4-number PIN keeps your family's papers safe. Pick one nobody would guess.") {
            if needName { Field(label: "Your name", text: $name) }
            Field(label: "New PIN", text: $pin, secure: true, keyboard: .numberPad)
            Field(label: "The same PIN again", text: $again, secure: true, keyboard: .numberPad)
            MessageView(model: model)
            PrimaryButton(title: model.busy ? "Saving..." : "Continue", enabled: !model.busy) {
                Task { await model.choosePin(name: needName ? name : nil, pin: pin, again: again) }
            }
        }
    }
}

// ---- families

struct CirclesView: View {
    @ObservedObject var model: AppModel
    let circles: [ParwahCore.Circle]
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette.of(scheme)
        Page(title: "Your families", sub: "Pick one to open.") {
            ForEach(circles) { c in
                Button { Task { await model.pick(c) } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(c.circleName).font(.title3.weight(.bold))
                        Text(summary(c)).foregroundStyle(p.soft)
                    }
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading).padding(18)
                    .background(p.card, in: RoundedRectangle(cornerRadius: 20))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(c.circleName)
            }
            MessageView(model: model)
            Button("Start or join another family") { model.startSetup() }.frame(minHeight: 48)
            Button("Sign out") { Task { await model.signOut() } }.frame(minHeight: 48)
        }
    }
    private func summary(_ c: ParwahCore.Circle) -> String {
        var bits: [String] = []
        if c.live > 0 { bits.append("a call is on now") }
        if c.waiting > 0 { bits.append("\(c.waiting) waiting to join") }
        if c.unread > 0 { bits.append("\(c.unread) new messages") }
        if c.openRequests > 0 { bits.append("\(c.openRequests) open requests") }
        return bits.isEmpty ? "\(c.memberCount) people" : bits.joined(separator: " · ")
    }
}

struct SetupView: View {
    @ObservedObject var model: AppModel
    @State private var joining = false
    @State private var circleName = ""
    @State private var code = ""
    @State private var me = ""
    @State private var elder = false
    var body: some View {
        Page(title: joining ? "Join your family" : "Start your family",
             sub: joining ? "Type the code someone in the family shared with you." : "Give it a name everyone will recognise.") {
            Picker("", selection: $joining) { Text("Start one").tag(false); Text("Join with a code").tag(true) }.pickerStyle(.segmented)
            if joining { Field(label: "Family code", text: $code) } else { Field(label: "Family name, for example Sharma Family", text: $circleName) }
            Field(label: "Your name in the family", text: $me)
            Toggle("I am an elder in this family (bigger buttons, simpler screens)", isOn: $elder).frame(minHeight: 48)
            MessageView(model: model)
            PrimaryButton(title: model.busy ? "Please wait..." : (joining ? "Join" : "Start the family"), enabled: !model.busy) {
                Task { joining ? await model.join(code: code, memberName: me, elder: elder) : await model.create(memberName: me, circleName: circleName, elder: elder) }
            }
        }
        .onAppear { me = model.user?.name ?? "" }
    }
}

struct WaitingView: View {
    @ObservedObject var model: AppModel
    let circleName: String
    let message: String
    var body: some View {
        Page(title: "Waiting to be let in", sub: message) {
            Text("Anyone already in \(circleName) can let you in. You will see the family here as soon as they do.")
            MessageView(model: model)
            Button("Check again") { Task { await model.backToCircles() } }.frame(minHeight: 48)
        }
    }
}

// ---- Today

struct TodayView: View {
    @ObservedObject var model: AppModel
    let seat: Seat
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette.of(scheme)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading) {
                        Text(model.family?.name ?? seat.circleName).font(.title.weight(.heavy)).accessibilityAddTraits(.isHeader)
                        Text("Today").foregroundStyle(p.soft)
                    }
                    Spacer()
                    Button("Families") { Task { await model.backToCircles() } }.frame(minHeight: 48)
                }
                if seat.isElder {
                    // An elder's big buttons come first, as on the web.
                    PrimaryButton(title: model.busy ? "Sending..." : "All is well", enabled: !model.busy) { Task { await model.checkIn() } }
                    Button { Task { await model.medicinesTaken() } } label: {
                        Text("Medicines taken").font(.title3.weight(.bold)).frame(maxWidth: .infinity, minHeight: 56)
                            .overlay(Capsule().stroke(p.link, lineWidth: 1.5))
                    }.disabled(model.busy)
                }
                MessageView(model: model)
                if let f = model.family {
                    if let s = f.sos.first {
                        Text("SOS from \(s.name). Open the family to help.").font(.headline).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                            .background(Mela.sos, in: RoundedRectangle(cornerRadius: 16))
                    }
                    HStack(spacing: 12) {
                        Tile(title: "Family", value: "\(f.members.count) people")
                        Tile(title: "Vault", value: f.docs.map { $0 == 1 ? "1 paper kept" : "\($0) papers kept" } ?? "Papers, kept safe")
                    }
                    if !f.joinRequests.isEmpty { Tile(title: "Waiting to join", value: f.joinRequests.map(\.name).joined(separator: ", ")) }
                    Text("What happened").font(.headline).accessibilityAddTraits(.isHeader)
                    if f.events.isEmpty { Text("Nothing yet today. When someone checks in, it shows here.").foregroundStyle(p.soft) }
                    ForEach(f.events.prefix(30)) { e in EventRow(event: e) }
                    Button("Sign out") { Task { await model.signOut() } }.frame(minHeight: 48)
                } else { ProgressView() }
            }
            .padding(20).frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
    }
}

struct Tile: View {
    let title: String
    let value: String
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let p = Palette.of(scheme)
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline).foregroundStyle(p.soft)
            Text(value).font(.headline)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
        .background(p.card, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

struct EventRow: View {
    let event: FamilyEvent
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let who = event.member_name ?? "Someone"
        let what: String = {
            switch event.type {
            case "checkin": return "\(who) said all is well"
            case "pill": return "\(who) took their medicines"
            case "sos": return "\(who) sent an SOS"
            case "join": return "\(who) joined the family"
            default: return [who, event.text ?? ""].filter { !$0.isEmpty }.joined(separator: ": ")
            }
        }()
        HStack(spacing: 12) {
            SwiftUI.Circle().fill(Mela.marigold).frame(width: 10, height: 10)
            VStack(alignment: .leading) {
                Text(what)
                Text(ago(event.created_at)).font(.footnote).foregroundStyle(Palette.of(scheme).soft)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
    private func ago(_ iso: String) -> String {
        guard let t = ISO8601DateFormatter.withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let m = Int(Date().timeIntervalSince(t) / 60)
        switch m {
        case ..<1: return "just now"
        case ..<60: return m == 1 ? "1 minute ago" : "\(m) minutes ago"
        case ..<1440: return m / 60 == 1 ? "1 hour ago" : "\(m / 60) hours ago"
        default: return m / 1440 == 1 ? "yesterday" : "\(m / 1440) days ago"
        }
    }
}

extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}
