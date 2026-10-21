import Foundation
import ParwahCore

/// Where the person is. One screen at a time, like the web app's steps.
enum Step: Equatable {
    case starting
    case phone
    case pin(older: Bool)
    case choose(needName: Bool, replacing: Bool)
    case circles([ParwahCore.Circle])
    case setup
    case waiting(circleName: String, message: String)
    case today(Seat)
}

@MainActor
final class AppModel: ObservableObject {
    static let baseURL = "https://parwah-hq.anchit-tandon.com"

    @Published private(set) var step: Step = .starting
    @Published private(set) var busy = false
    @Published var message: String?
    @Published private(set) var family: Family?
    @Published private(set) var phone = ""
    @Published private(set) var cc: String

    private let tokens: TokenStore
    private let remembered: Remembered
    private let auth: AuthClient
    private let families: FamilyClient
    private var oldSecret: String?
    private var poll: Task<Void, Never>?

    var user: User? { remembered.user }

    init(transport: Transport = URLSessionTransport(), tokens: TokenStore = KeychainTokenStore(), remembered: Remembered = Remembered()) {
        self.tokens = tokens
        self.remembered = remembered
        self.cc = remembered.cc
        let api = Api(base: Self.baseURL, transport: transport, tokens: tokens)
        auth = AuthClient(api: api, tokens: tokens)
        families = FamilyClient(api: api)
        Task { await boot() }
    }

    /// Same order as the web app's boot: a family on this phone, then an account, then sign-in.
    private func boot() async {
        if let u = remembered.user, tokens.token != nil {
            if let s = remembered.seat { await act { try await self.open(s) } }
            else { await act { self.phone = u.phone ?? ""; self.handle(try await self.auth.refresh(phone: u.phone ?? "", cc: self.cc)) } }
            if step == .starting { step = .phone }
        } else { step = .phone }
    }

    func submitPhone(_ number: String, cc code: String) async {
        await act {
            self.phone = number.filter(\.isNumber); self.cc = code; self.remembered.cc = code
            guard self.phone.count >= 6 else { self.message = "Please check the number. It looks too short."; return }
            self.handle(try await self.auth.enter(phone: self.phone, cc: self.cc))
        }
    }

    func submitPin(_ pin: String) async {
        await act { self.oldSecret = pin; self.handle(try await self.auth.enter(phone: self.phone, cc: self.cc, pin: pin)) }
    }

    /// Choosing a PIN: checked on the phone with the server's own rule first.
    func choosePin(name: String?, pin: String, again: String) async {
        await act {
            if let e = Pin.error(pin) { self.message = e; return }
            guard pin == again else { self.message = "The two PINs are not the same. Please type it again."; return }
            if case .choose(_, true) = self.step {
                self.handle(try await self.auth.enter(phone: self.phone, cc: self.cc, pin: self.oldSecret, newPin: pin))
            } else {
                let n = name?.trimmingCharacters(in: .whitespaces)
                self.handle(try await self.auth.enter(phone: self.phone, cc: self.cc, name: n?.isEmpty == false ? n : nil, pin: pin))
            }
        }
    }

    private func handle(_ r: Enter) {
        message = nil
        switch r {
        case .newNumber(let e): step = .choose(needName: true, replacing: false); message = e
        case .askPin(let older): step = .pin(older: older)
        case .choosePin(let e): step = .choose(needName: false, replacing: false); message = e
        case .replaceSecret(_, let e): step = .choose(needName: false, replacing: true); message = e ?? "Please choose a new 4-number PIN."
        case .wrongPin(_, let e), .locked(let e), .refused(let e): message = e
        case .signedIn(let user, let circles, _):
            oldSecret = nil
            remembered.user = user
            step = circles.isEmpty ? .setup : .circles(circles)
        }
    }

    func pick(_ c: ParwahCore.Circle) async { await act { try await self.open(c.seat(personName: self.user?.name ?? "")) } }
    func startSetup() { message = nil; step = .setup }

    func create(memberName: String, circleName: String, elder: Bool) async {
        await act {
            guard let u = self.user else { return }
            guard !circleName.trimmingCharacters(in: .whitespaces).isEmpty else { self.message = "Please give the family a name."; return }
            try await self.open(try await self.families.create(user: u, memberName: memberName.isEmpty ? u.name : memberName, circleName: circleName, elder: elder))
        }
    }

    func join(code: String, memberName: String, elder: Bool) async {
        await act {
            guard let u = self.user else { return }
            switch try await self.families.join(user: u, code: code, memberName: memberName.isEmpty ? u.name : memberName, elder: elder) {
            case .joined(let s): try await self.open(s)
            case .waiting(let n, let m): self.step = .waiting(circleName: n, message: m)
            case .refused(let e): self.message = e
            }
        }
    }

    func backToCircles() async {
        poll?.cancel(); remembered.seat = nil; family = nil
        await act { if let u = self.user { self.handle(try await self.auth.refresh(phone: u.phone ?? "", cc: self.cc)) } }
    }

    private func open(_ seat: Seat) async throws {
        remembered.seat = seat
        family = try await families.load(seat)
        step = .today(seat)
        poll?.cancel()
        // The web app looks every 12 seconds while it is open; so does this.
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 12_000_000_000)
                guard let self, !Task.isCancelled else { return }
                do { self.family = try await self.families.load(seat) }
                catch ApiError.signedOut(let m) { self.signedOut(m); return }
                catch {}
            }
        }
    }

    func checkIn() async {
        await act { if case .today(let s) = self.step { try await self.families.checkIn(s); self.message = "The family can see you are well."; self.family = try await self.families.load(s) } }
    }

    func medicinesTaken() async {
        await act { if case .today(let s) = self.step { try await self.families.medicinesTaken(s); self.message = "Noted. The family can see it."; self.family = try await self.families.load(s) } }
    }

    func signOut() async {
        poll?.cancel()
        await auth.signOut()
        remembered.clear(); family = nil; step = .phone
    }

    private func signedOut(_ why: String) {
        poll?.cancel(); remembered.seat = nil; family = nil
        step = .phone; message = why
    }

    /// One action at a time: a second tap while the first is on its way does nothing.
    private func act(_ block: @escaping () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do { try await block() }
        catch ApiError.signedOut(let m) { signedOut(m) }
        catch let e as ApiError { message = e.message }
        catch { message = "Something went wrong. Please try again." }
    }
}
