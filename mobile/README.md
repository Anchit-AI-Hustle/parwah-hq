# Parwah native apps (Android + iOS)

## Current route: the Floot shell

The store apps are built by Floot from a thin shell project, "Parwah"
(`parwah.floot.app`, app id `com.parwah.app`). Its one page shows
`https://parwah-hq.anchit-tandon.com/app/` full-screen in a frame, with a
loading screen until the app posts `{ parwah: 'ready' }`, and a retry screen
if it never does. No family data passes through Floot; its visitor analytics
are switched off.

For this to work, `/app/` sends `Content-Security-Policy: frame-ancestors`
listing exactly the shell's origins (see `vercel.json`); every other page
keeps `X-Frame-Options: SAMEORIGIN`. `site/tests/browser/shell.browser.mjs`
checks the frame behaviour in Chromium (Android's engine). Sign-in staying
remembered inside the frame on iPhone has to be checked on a real device.

Inside the frame the browser does not allow web push, so reminders do not
arrive as phone notifications in the store apps.

The Capacitor project below is the alternative that needs no frame, if the
shell ever has to be replaced.

## Capacitor shell (not in use)

Capacitor shells that wrap the live Parwah app (`https://parwah-hq.anchit-tandon.com/app/`).
The web app is the single source of truth - native builds always show the latest
deploy, so the apps never go stale.

## Android - automatic

`.github/workflows/android-apk.yml` builds a debug APK on every push that touches
`mobile/` (or manually via *Run workflow*), then commits it to
`site/public/downloads/parwah.apk`. Vercel deploys it, and the direct-install
button on `/get/` lights up automatically.

For a **Play Store** release: create a signing keystore, add it as repo secrets,
switch the workflow to `assembleRelease`, and upload the AAB from a
`bundleRelease` build to the Play Console (one-time $25 developer account).

## iOS - needs an Apple Developer account

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
