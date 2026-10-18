# Parwah for Android and iPhone

Native apps built with Capacitor 8 around the live Parwah app at
`https://parwah-hq.anchit-tandon.com/`. The apps open the live app directly
(not in a frame), so every web deploy reaches every phone at once and the
apps never go stale. App id: `com.parwah.app`.

| | Android | iPhone / iPad |
|---|---|---|
| Runs on | Android 7.0 and later (minSdk 24), phones and tablets | iOS 15 and later, iPhone and iPad |
| Built by | `.github/workflows/mobile.yml` on GitHub (Linux) | the same workflow (macOS, latest Xcode) |
| You get | `parwah.apk` (install directly) and `parwah.aab` (Google Play) | `parwah-ios-unsigned.ipa` |
| Proven on | Android 11 and Android 15 emulators, every build | the newest iPhone simulator, every build |

## What is native

- Location (for "Where everyone is"), camera and microphone (family calls,
  photos, the voice helper) and photo picking. Each is asked for only when the
  person uses the feature; phones without a camera or GPS can still install.
- An offline page in Parwah's own look (`www/index.html`) with "Try again",
  shown when the phone cannot reach Parwah. It needs no network.
- Icons and splash screens in the Mela look, light and dark, generated from
  `assets/` (`npx @capacitor/assets generate`).
- The app adds `ParwahApp/1.0` to its browser identity, so the web app hides
  its "Get the app" links inside it.
- The sign-in token never leaves the phone in a cloud backup.

## Releases

Every push to `main` that touches `mobile/` (or **Run workflow** by hand)
builds both apps, installs and opens them on the emulators and the simulator,
and only then publishes one GitHub Release with the APK, the AAB, the IPA and
the screenshots. The APK reaches the public `/get/` page through a pull
request that adds it to `site/public/downloads/parwah.apk`; the button there
appears on its own once the file exists.

### Android signing (release key)

The release key is NOT in this repository. It lives in four GitHub secrets:
`PARWAH_KEYSTORE_BASE64`, `PARWAH_KEYSTORE_PASSWORD`, `PARWAH_KEY_ALIAS`
(`parwah`), `PARWAH_KEY_PASSWORD`. The owner holds the backup. The key was made on 2026-10-18 (RSA 4096, PKCS12, valid to 2054); the earlier key was never used for a published build. Certificate
SHA-256: `E7:71:76:CD:4A:F4:5A:36:74:7E:F9:23:96:20:16:8C:7F:F4:DD:4D:82:1E:2B:B9:0C:11:10:96:08:DE:26:4E`;
the workflow refuses a signed build that does not carry exactly this.
Without the secrets the workflow builds a TEST APK (debug-signed, marked as a
prerelease): it installs, but the next release will not install over it.

For Google Play: create the app in the Play Console (one-time US$25), turn on
Play App Signing and upload `parwah.aab`.

### iPhone signing

Apple only lets a signed app install on an iPhone. Until there is an Apple
Developer account (US$99 a year), the IPA is unsigned and can be installed
with your own Apple ID through AltStore or Sideloadly (re-signed every 7
days), and everyone else uses Safari's Share > Add to Home Screen, which the
web app already supports. With an account: add the signing certificate and
provisioning profile as secrets and export a signed IPA for TestFlight and
the App Store.

### Your own iPhone with a free Apple ID

On a Mac with Xcode 15 or newer and the iPhone plugged in:

```
curl -fsSLO https://raw.githubusercontent.com/Anchit-AI-Hustle/parwah-hq/main/mobile/ci/ios-install-free.sh
bash ios-install-free.sh
```

It downloads the code, builds the app, signs it with your Personal Team and
installs it. The first time it stops once to ask you to add your Apple ID in
Xcode > Settings > Accounts. Apple stops free-signed apps from opening after
7 days; run it again to renew. The phone needs Developer Mode on (iOS 16+)
and, the first time, Settings > General > VPN & Device Management > Trust.
Every build runs this script on a Mac in CI up to the two steps that need a
person (the Apple ID and the phone).

## Building on a computer

```
cd mobile
npm ci
npx cap sync
npx cap open android   # Android Studio
npx cap open ios       # Xcode, on a Mac
```

The Floot shell (`parwah.floot.app`) that frames the app is the earlier route
and still works; these apps replace it.
