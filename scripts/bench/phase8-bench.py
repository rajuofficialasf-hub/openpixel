#!/usr/bin/env python3
"""Phase 8 benchmark harness for OpenPixel Studio.

Runs real `openpixel` CLI commands, times wall-clock with perf_counter,
and records peak tree RSS (parent + all descendants, incl. the
supervised isolation children) by polling /proc every 5 ms.

Usage:
    python3 scripts/bench/phase8-bench.py [--quick]
Results are printed as a table and written to
dist/bench/results-<date>.json (raw per-run numbers, no averaging
hidden from the reader).

Every row is a real measured run on this machine. Nothing here is
estimated.
"""
import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "target" / "release" / "openpixel"
DIST = ROOT / "dist" / "bench"
FIX = Path("/tmp/op-e2e/cli/in")
OCR_FIX = ROOT / "crates/openpixel-ocr/tests/fixtures"


def tree_rss_kib(root_pid):
    """Sum VmRSS (KiB) of root_pid + all descendants, via /proc."""
    ppid = {}
    rss = {}
    try:
        pids = [p for p in os.listdir("/proc") if p.isdigit()]
    except OSError:
        return 0
    for p in pids:
        try:
            with open(f"/proc/{p}/status") as f:
                pid = ppid_of = None
                mem = 0
                for line in f:
                    if line.startswith("Pid:"):
                        pid = int(line.split()[1])
                    elif line.startswith("PPid:"):
                        ppid_of = int(line.split()[1])
                    elif line.startswith("VmRSS:"):
                        mem = int(line.split()[1])
                if pid is not None:
                    ppid[pid] = ppid_of
                    rss[pid] = mem
        except (OSError, ValueError):
            continue
    total = 0
    stack = [root_pid]
    seen = set()
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        total += rss.get(pid, 0)
        stack.extend(c for c, par in ppid.items() if par == pid)
    return total


def run(cmd, env_extra=None, poll_s=0.005):
    """Run cmd (list), return dict(wall_s, peak_rss_mib, rc, out)."""
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    t0 = time.perf_counter()
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        env=env, text=True)
    peak = 0
    while proc.poll() is None:
        peak = max(peak, tree_rss_kib(proc.pid))
        time.sleep(poll_s)
    peak = max(peak, tree_rss_kib(proc.pid))
    out, _ = proc.communicate()
    return {
        "wall_s": time.perf_counter() - t0,
        "peak_rss_mib": peak / 1024.0,
        "rc": proc.returncode,
        "out": (out or "").strip().splitlines()[-3:],
        "full_out": (out or "")[:20000],
    }


def bench(name, cmd, iters=3, env_extra=None):
    rows = []
    for i in range(iters):
        r = run(cmd, env_extra)
        assert r["rc"] == 0, f"{name} iter {i} failed rc={r['rc']}: {r['out']}"
        rows.append(r)
        print(f"  {name} [{i+1}/{iters}] {r['wall_s']:.3f}s "
              f"peakRSS {r['peak_rss_mib']:.1f} MiB")
    walls = [r["wall_s"] for r in rows]
    return {
        "name": name, "cmd": " ".join(str(c) for c in cmd),
        "env": env_extra or {}, "iters": iters,
        "wall_s": walls,
        "mean_s": sum(walls) / len(walls),
        "min_s": min(walls), "max_s": max(walls),
        "peak_rss_mib": max(r["peak_rss_mib"] for r in rows),
    }


def main():
    quick = "--quick" in sys.argv
    results = []
    op = str(BIN)
    out = DIST / "out"
    out.mkdir(parents=True, exist_ok=True)
    batch12 = DIST / "in" / "batch12"
    iters = 2 if quick else 3

    print("== A. engine baseline (openpixel bench) ==")
    r = run([op, "bench", "--iterations", "3", "--json"])
    print(r["out"])
    assert r["rc"] == 0, r["out"]
    (DIST / "bench-suite.json").write_text(r["full_out"])
    results.append({"name": "bench_suite", "cmd": f"{op} bench --iterations 3",
                    "wall_s": [r["wall_s"]], "mean_s": r["wall_s"],
                    "peak_rss_mib": None, "raw_json": r["full_out"]})

    print("== B. single-image converts (photo.jpg 1024x768, 764 KiB) ==")
    photo = FIX / "photo.jpg"
    for fmt, extra in [("webp", ["--quality", "80"]),
                       ("jpg", ["--quality", "80"]),
                       ("png", [])]:
        results.append(bench(
            f"convert photo.jpg -> {fmt} q80",
            [op, "convert", str(photo), str(out / f"photo.{fmt}")] + extra,
            iters=iters))
    # AVIF is ~10 s a run: 2 iterations only, even in a full run.
    results.append(bench("convert photo.jpg -> avif q80",
                         [op, "convert", str(photo), str(out / "photo.avif"),
                          "--quality", "80"], iters=2))
    print("== B2. large image (big.png 4000x3000, 42 KiB PNG) ==")
    results.append(bench("convert big.png 4000x3000 -> webp q80",
                         [op, "convert", str(FIX / "big.png"),
                          str(out / "big.webp"), "--quality", "80"],
                         iters=iters))
    results.append(bench("convert photo-2048.png 2048x1536 -> webp q80",
                         [op, "convert", str(FIX / "photo-2048.png"),
                          str(out / "photo-2048.webp"), "--quality", "80"],
                         iters=iters))

    print("== C. batch converts (12 files: 6x photo.jpg + 6x photo-2048.png) ==")
    for workers in (1, 2, 4):
        results.append(bench(
            f"batch 12 files -> webp q80, workers={workers}",
            [op, "batch", str(batch12), "--format", "webp",
             "--quality", "80", "--workers", str(workers),
             "--out-dir", str(out / f"batch-w{workers}")],
            iters=iters))

    print("== D. large-PDF operations (big200 fixtures) ==")
    big_img = DIST / "in" / "big200-img.pdf"
    big_txt = DIST / "in" / "big200-text.pdf"
    results.append(bench("pdf merge big200-img + text2.pdf",
                         [op, "pdf", "merge", str(big_img),
                          str(FIX / "text2.pdf"), "-o",
                          str(out / "merged.pdf")], iters=iters))
    results.append(bench("pdf split big200-text 1-100,101-200",
                         [op, "pdf", "split", str(big_txt),
                          "--ranges", "1-100,101-200",
                          "--out-dir", str(out / "split")], iters=iters))
    results.append(bench("pdf compress big200-img (ebook default)",
                         [op, "pdf", "compress", str(big_img),
                          str(out / "big200-img-compressed.pdf")],
                         iters=iters))
    results.append(bench("pdf render big200-img pp.1-20 scale 2.0 png",
                         [op, "pdf", "render", str(big_img),
                          "--pages", "1-20", "--scale", "2.0",
                          "--out-dir", str(out / "render20")], iters=iters))
    results.append(bench("pdf extract-text big200-text (all pages)",
                         [op, "pdf", "extract-text", str(big_txt),
                          "-o", str(out / "big200-text.txt")], iters=iters))

    print("== E. batch OCR (fixtures in crates/openpixel-ocr/tests/fixtures) ==")
    for name, lang in [("eng-clean", "eng"), ("eng-noisy", "eng"),
                       ("eng-lowdpi", "eng"), ("eng-skewed", "eng"),
                       ("ben-clean", "ben"), ("ben-noisy", "ben"),
                       ("ben-lowdpi", "ben")]:
        results.append(bench(
            f"ocr {name} ({lang})",
            [op, "ocr", str(OCR_FIX / f"{name}.png"), "--lang", lang,
             "-o", str(out / f"ocr-{name}.txt")], iters=2))

    print("== F. isolation model: batch workers=4, supervised vs NO_ISOLATION ==")
    results.append(bench("batch 12 webp w4 (supervised, default)",
                         [op, "batch", str(batch12), "--format", "webp",
                          "--quality", "80", "--workers", "4",
                          "--out-dir", str(out / "batch-iso")], iters=iters))
    results.append(bench("batch 12 webp w4 (OPENPIXEL_NO_ISOLATION=1)",
                         [op, "batch", str(batch12), "--format", "webp",
                          "--quality", "80", "--workers", "4",
                          "--out-dir", str(out / "batch-noiso")],
                         iters=iters,
                         env_extra={"OPENPIXEL_NO_ISOLATION": "1"}))

    stamp = date.today().isoformat()
    dest = DIST / f"results-{stamp}.json"
    dest.write_text(json.dumps(results, indent=2))
    print(f"\nWrote {dest}")
    print("\n== summary ==")
    for r in results:
        if "wall_s" in r and isinstance(r["wall_s"], list) and r["wall_s"]:
            rss = f"peakRSS {r['peak_rss_mib']:.1f} MiB" \
                if r.get("peak_rss_mib") else ""
            spread = f"[{r['min_s']:.3f}..{r['max_s']:.3f}]" \
                if "min_s" in r else f"[{r['wall_s'][0]:.3f}]"
            print(f"{r['mean_s']:8.3f}s mean "
                  f"{spread} {rss}  {r['name']}")


if __name__ == "__main__":
    main()
