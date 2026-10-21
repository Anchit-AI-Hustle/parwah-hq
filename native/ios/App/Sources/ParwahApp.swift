import SwiftUI

@main
struct ParwahApp: App {
    @StateObject private var model: AppModel = {
        #if DEBUG
        // UI tests launch the app against a scripted server, never the live one.
        if ProcessInfo.processInfo.arguments.contains("-uitest") {
            UserDefaults.standard.removePersistentDomain(forName: Bundle.main.bundleIdentifier ?? "")
            return AppModel(transport: ScriptedServer(), tokens: MemoryTokenStoreBox())
        }
        #endif
        return AppModel()
    }()
    var body: some Scene { WindowGroup { RootView(model: model) } }
}
