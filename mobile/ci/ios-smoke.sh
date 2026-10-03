#!/usr/bin/env bash
# Run the simulator build on an iPhone simulator and prove it opens, stays
# running and shows the live Parwah app (a light screen; the splash and the
# offline page are dark jamun).
# Usage: mobile/ci/ios-smoke.sh <App.app> <out-dir>
set -uo pipefail
APP="$1"; OUT="$2"; BID=com.parwah.app
mkdir -p "$OUT"; fail=0
pass(){ echo "PASS  $*"; }; bad(){ echo "FAIL  $*"; fail=1; }

UDID=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
best=None
for rt,devs in d.items():
    if "iOS" not in rt: continue
    for x in devs:
        if x["name"].startswith("iPhone") and (best is None or rt>best[0]): best=(rt,x["udid"],x["name"])
print(best[1] if best else "")')
[ -n "$UDID" ] || { echo "FAIL  no iPhone simulator"; exit 1; }
xcrun simctl list devices | grep "$UDID" | head -1
xcrun simctl boot "$UDID" 2>/dev/null; xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance light 2>/dev/null || true
xcrun simctl install "$UDID" "$APP" && pass "the app installs" || bad "the app did not install"
xcrun simctl launch "$UDID" "$BID" >/dev/null && pass "the app launches" || bad "the app did not launch"
sleep 40
xcrun simctl io "$UDID" screenshot "$OUT/iphone.png" >/dev/null
xcrun simctl spawn "$UDID" launchctl list | grep -q "$BID" && pass "the app is still running after 40s" || bad "the app is not running"

# How much of the middle of the screen is light (the live app) vs dark (splash/offline).
sips -s format bmp "$OUT/iphone.png" --out "$OUT/iphone.bmp" >/dev/null
LIGHT=$(python3 - "$OUT/iphone.bmp" <<'PY'
import struct,sys
b=open(sys.argv[1],'rb').read()
off=struct.unpack_from('<I',b,10)[0]; w,h=struct.unpack_from('<ii',b,18); bpp=struct.unpack_from('<H',b,28)[0]//8
row=(w*bpp+3)//4*4; ah=abs(h); light=n=0
for y in range(int(ah*.3),int(ah*.8),7):
    r0=off+y*row
    for x in range(0,w,7):
        B,G,R=b[r0+x*bpp],b[r0+x*bpp+1],b[r0+x*bpp+2]
        n+=1; light+= (0.2126*R+0.7152*G+0.0722*B)>200
print(round(100*light/max(n,1)))
PY
)
echo "light share of the middle of the screen: ${LIGHT}%"
[ "${LIGHT:-0}" -ge 30 ] && pass "the live Parwah app is on screen" || bad "the screen is still dark (splash or offline page)"
rm -f "$OUT/iphone.bmp"
# A small copy of the screenshot in the log, so it can be reviewed by anyone
# who can read the log but not download the artifacts.
if sips -Z 420 -s format jpeg -s formatOptions 55 "$OUT/iphone.png" --out "$OUT/iphone-small.jpg" >/dev/null 2>&1; then
  echo "SCREENSHOT iphone BEGIN"; base64 -i "$OUT/iphone-small.jpg" | fold -w 900; echo "SCREENSHOT iphone END"
fi
[ $fail -eq 0 ] && echo "IOS SMOKE TEST PASSED" || echo "IOS SMOKE TEST FAILED"
exit $fail
