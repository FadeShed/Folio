#!/usr/bin/env python3
"""Assemble Folio.html from the local sources and bundled dependencies."""

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "APP_CSS": "src/app.css",
    "READING_CSS": "src/reading.css",
    "MATH_CSS": "vendor/math.css",
    "VENDOR_JS": "vendor/vendor.js",
    "MATH_JS": "vendor/math-vendor.js",
    "RENDERER_JS": "src/renderer.js",
    "STORAGE_JS": "src/storage.js",
    "WATCHER_JS": "src/watcher.js",
    "APP_JS": "src/app.js",
}


def assemble():
    html = (ROOT / "src/template.html").read_text(encoding="utf-8")
    for marker, relative in SOURCES.items():
        body = (ROOT / relative).read_text(encoding="utf-8")
        closing_tag = "</script" if relative.endswith(".js") else "</style"
        if closing_tag in body.lower():
            raise ValueError(f"Unsafe closing tag in {relative}")
        placeholder = "/*__" + marker + "__*/"
        if html.count(placeholder) != 1:
            raise ValueError(f"Expected exactly one {marker} placeholder")
        html = html.replace(placeholder, body)
    if "/*__" in html:
        raise ValueError("Unresolved template placeholder")
    return html.encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check that Folio.html matches the sources without writing it")
    args = parser.parse_args()
    expected = assemble()
    target = ROOT / "Folio.html"
    if args.check:
        if not target.exists() or target.read_bytes() != expected:
            parser.exit(1, "Folio.html differs from the sources. Run python3 scripts/build.py.\n")
        print("Folio.html matches the sources.")
    else:
        target.write_bytes(expected)
        print(f"Built Folio.html ({len(expected):,} bytes).")


if __name__ == "__main__":
    main()
