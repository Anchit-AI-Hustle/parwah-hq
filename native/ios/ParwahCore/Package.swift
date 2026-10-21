// swift-tools-version:5.9
// Everything in the iPhone app that is not a screen: the API client, the
// sign-in flow and the rules shared with the server. Plain Foundation, so its
// tests run with `swift test` on a Mac or on Linux, with no simulator.
import PackageDescription

let package = Package(
    name: "ParwahCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ParwahCore", targets: ["ParwahCore"])],
    targets: [
        .target(name: "ParwahCore"),
        .testTarget(name: "ParwahCoreTests", dependencies: ["ParwahCore"]),
    ]
)
