#!/usr/bin/env bash
# Install the built APK on a running emulator and prove it works the way a
# family will use it: it opens, it does not crash, the live Parwah app loads
# inside it, and with no internet the offline page offers "Try again".
# Usage: mobile/ci/android-smoke.sh <apk> <out-dir>
set -uo pipefail
APK="$1"; OUT="$2"; PKG=com.parwah.app
mkdir -p "$OUT"
fail=0
pass(){ echo "PASS  $*"; }
bad(){ echo "FAIL  $*"; fail=1; }

screen_text(){  # every text and description on screen, one per line
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
  grep -oE '(text|content-desc)="[^"]+"' "$OUT/ui.xml" | sed -E 's/^[a-z-]+="//; s/"$//'
}
wait_for(){     # wait_for <regex> <seconds> : poll the screen until the text appears
  local re="$1" t="$2" i=0
  while [ $i -lt "$t" ]; do
    if screen_text | grep -qiE "$re"; then return 0; fi
    sleep 3; i=$((i+3))
  done
  return 1
}

adb logcat -c
adb install -r "$APK" >/dev/null && pass "the APK installs" || bad "the APK did not install"
adb shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true

# 1. Online: the live app loads inside the app.
adb shell am start -W -n $PKG/.MainActivity >/dev/null
if wait_for 'mobile number|your family|sign in|parwah' 90; then pass "the live Parwah app loads inside the app"
else bad "the live app never appeared"; screen_text | head -40; fi
sleep 3
adb exec-out screencap -p > "$OUT/online.png"
adb shell pidof $PKG >/dev/null && pass "the app is still running" || bad "the app is not running"

# 2. Offline: no internet shows our page with Try again, not a browser error.
adb shell svc wifi disable; adb shell svc data disable; adb shell cmd connectivity airplane-mode enable 2>/dev/null || true
sleep 3
# A brand-new install with no internet: clear the app so the live app's own
# offline cache (its service worker) cannot stand in for our page.
adb shell pm clear $PKG >/dev/null
adb shell am start -W -n $PKG/.MainActivity >/dev/null
if wait_for 'try again|could not reach your family' 60; then pass "offline, it shows the Parwah offline page"
else bad "offline, the offline page did not appear"; screen_text | head -40; fi
adb exec-out screencap -p > "$OUT/offline.png"
adb shell cmd connectivity airplane-mode disable 2>/dev/null || true
adb shell svc wifi enable; adb shell svc data enable

# 3. No crash at any point.
adb logcat -d > "$OUT/logcat.txt"
if grep -qE "FATAL EXCEPTION|Process: $PKG" "$OUT/logcat.txt"; then
  bad "the app crashed"; grep -A15 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40
else pass "no crash in the log"; fi

# Small copies of the screenshots in the log, so they can be reviewed by
# anyone who can read the log but not download the artifacts.
for shot in online offline; do
  if command -v convert >/dev/null && convert "$OUT/$shot.png" -resize 360x -quality 55 "$OUT/$shot-small.jpg" 2>/dev/null; then
    echo "SCREENSHOT $shot BEGIN"; base64 -w 900 "$OUT/$shot-small.jpg"; echo "SCREENSHOT $shot END"
  fi
done

[ $fail -eq 0 ] && echo "ANDROID SMOKE TEST PASSED" || echo "ANDROID SMOKE TEST FAILED"
exit $fail
