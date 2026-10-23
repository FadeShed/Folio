#!/usr/bin/env python3
"""Recreate the offline Mermaid bundle from its pinned npm archive.

Download the archive identified in vendor/manifest.json separately, then run:
    python3 scripts/vendor_mermaid.py /path/to/mermaid-12.2.0.tgz
This preparation step is optional; the normal Folio build uses checked-in files
and never downloads anything.
"""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile


ROOT = Path(__file__).resolve().parents[1]


def assemble(archive):
    manifest = json.loads((ROOT / "vendor/manifest.json").read_text(encoding="utf-8"))
    entry = next(item for item in manifest["bundled"] if item["package"] == "mermaid")
    data = archive.read_bytes()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")
    if integrity != entry["integrity"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise ValueError("Mermaid archive integrity does not match vendor/manifest.json")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as source:
        package = json.load(source.extractfile("package/package.json"))
        if package["version"] != entry["version"]:
            raise ValueError("Unexpected Mermaid version")
        javascript = source.extractfile(entry["sourceFile"]).read()
        license_text = source.extractfile("package/LICENSE").read()
    if hashlib.sha256(javascript).hexdigest() != entry["sourceSha256"]:
        raise ValueError("Unexpected Mermaid distribution file")
    if license_text != (ROOT / "licenses/Mermaid-MIT.txt").read_bytes():
        raise ValueError("Mermaid license differs from the upstream archive")
    notices = license_text.decode("utf-8") + "\n" + (ROOT / "licenses/Mermaid-THIRD-PARTY.txt").read_text(encoding="utf-8")
    # Keep complete notices in the standalone HTML, even when it is distributed
    # without the repository. Protect the surrounding JavaScript comment.
    header = (
        "/*! Folio: Mermaid " + entry["version"] + " — official standalone IIFE.\n"
        + " * Source: " + entry["tarball"] + "\n"
        + " * Full upstream and bundled dependency license notices follow.\n\n"
        + notices.replace("*/", "* /") + "\n*/\n"
    )
    result = header.encode("utf-8") + javascript
    if b"</script" in result.lower():
        raise ValueError("Unexpected HTML script closing tag in Mermaid bundle")
    if hashlib.sha256(result).hexdigest() != entry["bundleSha256"]:
        raise ValueError("Mermaid bundle differs from its recorded SHA-256")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="The pinned npm mermaid archive")
    parser.add_argument("--check", action="store_true", help="Check the checked-in bundle without writing")
    args = parser.parse_args()
    expected = assemble(args.archive)
    target = ROOT / "vendor/mermaid-vendor.js"
    if args.check:
        if not target.exists() or target.read_bytes() != expected:
            parser.exit(1, "vendor/mermaid-vendor.js differs from the pinned distribution.\n")
        print("Mermaid bundle and archive integrity verified.")
    else:
        target.write_bytes(expected)
        print(f"Prepared Mermaid bundle ({len(expected):,} bytes).")


if __name__ == "__main__":
    main()
