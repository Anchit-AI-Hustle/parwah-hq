"""Writes site/public/install/parwah.mobileconfig: an iOS configuration
profile holding one Web Clip. Installing it from Safari puts Parwah on the
Home Screen as a full-screen app, on any iPhone, with no App Store, no
signing and no expiry. The UUIDs are fixed so installing again replaces the
same profile. Run again after the icon changes: python3 site/make-webclip.py
"""
import base64
import plistlib
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent / "public"
ORIGIN = "https://parwah-hq.anchit-tandon.com"

profile = {
    "PayloadContent": [{
        "PayloadType": "com.apple.webClip.managed",
        "PayloadVersion": 1,
        "PayloadIdentifier": "com.parwah.app.webclip",
        "PayloadUUID": "4E0C2B7A-9D31-4F6E-A8B5-2C71D0E93F14",
        "PayloadDisplayName": "Parwah",
        "URL": ORIGIN + "/",
        "Label": "Parwah",
        "Icon": (PUBLIC / "apple-touch-icon.png").read_bytes(),
        "FullScreen": True,
        "IsRemovable": True,
        "Precomposed": True,
    }],
    "PayloadType": "Configuration",
    "PayloadVersion": 1,
    "PayloadIdentifier": "com.parwah.app",
    "PayloadUUID": "B6A1F3D8-27C4-4E59-9F0A-6D3E8B12C7A5",
    "PayloadDisplayName": "Parwah app",
    "PayloadDescription": "Adds Parwah to your Home Screen as a full-screen app.",
    "PayloadOrganization": "Parwah",
    "PayloadRemovalDisallowed": False,
}

out = PUBLIC / "install" / "parwah.mobileconfig"
out.parent.mkdir(exist_ok=True)
out.write_bytes(plistlib.dumps(profile))
print("wrote", out.relative_to(PUBLIC.parent.parent), out.stat().st_size, "bytes")
