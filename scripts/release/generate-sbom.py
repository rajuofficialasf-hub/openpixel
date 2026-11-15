#!/usr/bin/env python3
"""Generate a CycloneDX 1.5 SBOM from a Cargo workspace lockfile.

Usage:
    python3 scripts/release/generate-sbom.py [--manifest PATH] [--out PATH]

Reads `cargo metadata` (from the existing Cargo.lock — no version
drift; network is used only to fetch missing crate manifests for
platform-only dependencies that were never downloaded here) and
writes a CycloneDX JSON SBOM listing every package in the resolve
graph: name, version, licence (from the crate's own metadata), and
source (crates.io / local path).

System (non-Cargo) dependencies are NOT in Cargo.lock and are listed
separately as external components in the notes section of the SBOM
(see docs/SECURITY-AUDIT.md): the only one is the system C library
libdav1d (AVIF decode), installed via apt, not via cargo.

Run from the repo root, or pass --manifest for the desktop backend
(apps/desktop/src-tauri/Cargo.toml), which has its own lockfile.
"""

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path


def cargo_metadata(manifest: Path) -> dict:
    # No --offline: the lockfile references a few platform-only
    # crates (e.g. anstyle-wincon) whose .crate files were never
    # downloaded on this Linux machine, so offline metadata fails.
    # Versions still come from Cargo.lock — nothing is upgraded.
    result = subprocess.run(
        ["cargo", "metadata", "--format-version", "1",
         "--manifest-path", str(manifest)],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        print(f"cargo metadata failed for {manifest}:\n{result.stderr}",
              file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="Cargo.toml",
                        help="manifest to resolve (default: Cargo.toml)")
    parser.add_argument("--out", default=None,
                        help="output JSON path (default: sbom.json next to the manifest)")
    args = parser.parse_args()

    manifest = Path(args.manifest).resolve()
    meta = cargo_metadata(manifest)
    packages = {p["id"]: p for p in meta["packages"]}

    components = []
    for node in meta["resolve"]["nodes"]:
        pkg = packages.get(node["id"])
        if pkg is None:
            continue
        source = pkg["source"]
        if source is None:
            external_ref = {"type": "vcs", "url": "local path package"}
            purl = None
        else:
            external_ref = None
            purl = f"pkg:cargo/{pkg['name']}@{pkg['version']}"
        component = {
            "type": "library",
            "bom-ref": purl or f"pkg:cargo/{pkg['name']}@{pkg['version']}?local",
            "name": pkg["name"],
            "version": pkg["version"],
            "licenses": (
                [{"license": {"id": pkg["license"]}}]
                if pkg.get("license")
                else [{"license": {"name": pkg.get("license_file", "unknown")}}]
            ),
            "description": pkg.get("description") or "",
            "purl": purl,
        }
        if external_ref:
            component["externalReferences"] = [external_ref]
        components.append(component)
    components.sort(key=lambda c: (c["name"].lower(), c["version"]))

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "component": {
                "type": "application",
                "name": meta["workspace_root"].split("/")[-1],
                "version": meta["packages"][0]["version"]
                if meta["packages"] else "0.1.0",
            },
            "properties": [
                {
                    "name": "openpixel:generator",
                    "value": "scripts/release/generate-sbom.py (cargo metadata from Cargo.lock)",
                },
                {
                    "name": "openpixel:system-dependency",
                    "value": "libdav1d 1.4.1 (system C library, apt) — AVIF decode; not a Cargo package, see native/licenses/",
                },
            ],
        },
        "components": components,
    }

    out = Path(args.out) if args.out else manifest.parent / "sbom.json"
    out.write_text(json.dumps(sbom, indent=2) + "\n", encoding="utf-8")
    unknown = [c["name"] for c in components
               if c["licenses"][0]["license"].get("id", "unknown") == "unknown"]
    print(f"wrote {out}: {len(components)} components")
    if unknown:
        print(f"WARNING: {len(unknown)} components without a licence field: "
              + ", ".join(unknown))


if __name__ == "__main__":
    main()
