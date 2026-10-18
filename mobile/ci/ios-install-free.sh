#!/usr/bin/env bash
# Put Parwah on your own iPhone with Xcode and a FREE Apple ID.
#
# Run on a Mac, with the iPhone plugged in by cable and unlocked:
#   bash ios-install-free.sh
# Optional:
#   TEAM_ID=ABCDE12345 bash ios-install-free.sh          your Personal Team ID
#   BUNDLE_ID=com.yourname.parwah bash ios-install-free.sh
#
# A free Apple ID can only sign apps for your own devices, and Apple makes
# them stop opening after 7 days: run this script again to renew. Up to 3
# such apps per phone at a time.
set -euo pipefail

say(){ printf '\n==> %s\n' "$*"; }
die(){ printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

# ---- 1. What the Mac needs -------------------------------------------------
[ "$(uname)" = "Darwin" ] || die "this needs a Mac."
command -v xcodebuild >/dev/null || die "install Xcode from the Mac App Store, open it once, then run this again."
xcodebuild -version >/dev/null 2>&1 || die "open Xcode once and accept its licence (or run: sudo xcodebuild -license accept)."
XCODE_MAJOR=$(xcodebuild -version | awk 'NR==1{split($2,v,"."); print v[1]}')
[ "${XCODE_MAJOR:-0}" -ge 15 ] || die "Xcode 15 or newer is needed (you have $(xcodebuild -version | head -1))."
command -v node >/dev/null && command -v npm >/dev/null || die "install Node.js 22 (https://nodejs.org) and run this again."
command -v git >/dev/null || die "install git (run: xcode-select --install)."

# ---- 2. The code -----------------------------------------------------------
if [ -f "mobile/capacitor.config.json" ]; then ROOT=$(pwd)
elif [ -f "capacitor.config.json" ] && [ -d "ios" ]; then ROOT=$(cd .. && pwd)
elif [ -f "../capacitor.config.json" ] && [ -d "../ios" ]; then ROOT=$(cd .. && cd .. && pwd)
else
  ROOT="$HOME/parwah-hq"
  if [ -d "$ROOT/.git" ]; then say "Updating $ROOT"; git -C "$ROOT" pull --ff-only
  else say "Downloading Parwah to $ROOT"; git clone --depth 1 https://github.com/Anchit-AI-Hustle/parwah-hq.git "$ROOT"; fi
fi
cd "$ROOT/mobile"
say "Installing the app's parts"
npm ci --no-audit --no-fund
npx cap sync ios

# ---- 3. Your Personal Team (the free Apple ID) -----------------------------
if [ -z "${TEAM_ID:-}" ]; then
  # Xcode keeps the teams of the Apple IDs added under Settings > Accounts.
  TEAM_ID=$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null \
            | sed -n 's/.*teamID = "\{0,1\}\([A-Z0-9]\{10\}\)"\{0,1\};.*/\1/p' | head -1 || true)
fi
if [ -z "${TEAM_ID:-}" ]; then
  # Or from a signing certificate Xcode has already made.
  TEAM_ID=$(security find-certificate -a -c "Apple Development" -p 2>/dev/null \
            | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1 || true)
fi
if [ -z "${TEAM_ID:-}" ]; then
  cat <<'MSG'

STOP: Xcode does not know your Apple ID yet. Once only:
  1. Open Xcode > Settings (Cmd+,) > Accounts.
  2. Press + > Apple ID, and sign in with anchit.tandon@gmail.com.
  3. You will see "(Personal Team)" under it. Close Settings.
Then run this script again.
MSG
  exit 1
fi
echo "Personal Team: $TEAM_ID"

# A free team cannot use an app ID another team has registered, so the app
# gets an ID of its own on this Mac unless you choose one.
BUNDLE_ID=${BUNDLE_ID:-com.parwah.app.$(echo "$TEAM_ID" | tr 'A-Z' 'a-z')}
echo "App ID: $BUNDLE_ID"

# ---- 4. The iPhone ---------------------------------------------------------
say "Looking for your iPhone (plugged in by cable, unlocked, 'Trust This Computer' accepted)"
DEV_JSON=$(mktemp)
xcrun devicectl list devices --json-output "$DEV_JSON" >/dev/null 2>&1 || true
DEVICE_ID=""; DEVICE_UDID=""; DEVICE_NAME=""
read -r DEVICE_ID DEVICE_UDID DEVICE_NAME < <(python3 - "$DEV_JSON" <<'PY'
import json, sys
try:
    devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devs = []
for d in devs:
    hw, cp = d.get("hardwareProperties", {}), d.get("connectionProperties", {})
    if hw.get("platform") == "iOS" and hw.get("reality", "physical") == "physical" and cp.get("pairingState") == "paired":
        name = d.get("deviceProperties", {}).get("name", "iPhone").replace(" ", "_")
        print(d["identifier"], hw.get("udid", ""), name)
        break
PY
) || true
rm -f "$DEV_JSON"
[ -n "${DEVICE_ID:-}" ] && [ -n "${DEVICE_UDID:-}" ] || die "no iPhone found. Plug it in by cable, unlock it, tap 'Trust' on the phone, and on iOS 16 or later turn on Settings > Privacy & Security > Developer Mode (the phone restarts). Then run this again."
echo "iPhone: ${DEVICE_NAME//_/ } ($DEVICE_UDID)"

# ---- 5. Build and sign -----------------------------------------------------
cd ios/App
PBX=App.xcodeproj/project.pbxproj
cp "$PBX" "$PBX.orig"
trap 'mv -f "$ROOT/mobile/ios/App/$PBX.orig" "$ROOT/mobile/ios/App/$PBX" 2>/dev/null || true' EXIT
# Only the app itself carries com.parwah.app; the libraries keep their own IDs.
sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = com.parwah.app;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/g" "$PBX"

say "Building and signing Parwah for your iPhone (the first time takes a few minutes)"
rm -rf build
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination "id=$DEVICE_UDID" -derivedDataPath build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  build | grep -E "error:|warning: .*[Ss]ign|BUILD (SUCCEEDED|FAILED)" || true
APP=$(ls -d build/Build/Products/Release-iphoneos/*.app 2>/dev/null | head -1)
[ -n "$APP" ] || die "the build did not finish. Open mobile/ios/App/App.xcodeproj in Xcode, pick the App target > Signing & Capabilities, choose your Personal Team, and press Run once; Xcode shows the exact reason there."

# ---- 6. Install and open ---------------------------------------------------
say "Installing on your iPhone"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
if xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1; then
  say "Done: Parwah is open on your iPhone."
else
  cat <<MSG

Parwah is installed. Before it opens the first time, on the iPhone:
  Settings > General > VPN & Device Management > Apple Development: anchit.tandon@gmail.com > Trust.
Then tap the Parwah icon.
MSG
fi
echo
echo "Free Apple ID: the app stops opening after 7 days. Run this script again to renew it; your family's data stays, it lives on Parwah's servers."
