# Parwah native apps (Android + iOS)

Capacitor shells that wrap the live Parwah app (`https://parwah-hq.anchit-tandon.com/app/`).
The web app is the single source of truth — native builds always show the latest
deploy, so the apps never go stale.

## Android — automatic

`.github/workflows/android-apk.yml` builds a debug APK on every push that touches
`mobile/` (or manually via *Run workflow*), then commits it to
`site/public/downloads/parwah.apk`. Vercel deploys it, and the direct-install
button on `/get/` lights up automatically.

For a **Play Store** release: create a signing keystore, add it as repo secrets,
switch the workflow to `assembleRelease`, and upload the AAB from a
`bundleRelease` build to the Play Console (one-time $25 developer account).

## iOS — needs an Apple Developer account

```
cd mobile
npm install
npx cap add ios
npx cap open ios   # requires a Mac with Xcode
```

Sign with the Apple Developer team (US$99/yr), then archive → TestFlight →
App Store. Until then, iPhone users get the full-screen app via Safari →
Share → **Add to Home Screen** (the PWA manifest makes it feel native).

## Local Android build

```
cd mobile
npm install
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```
