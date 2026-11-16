# HEIC test fixtures

Real HEIC files encoded by **Apple's `sips`** (macOS), taken from the
[`heic-rs`](https://github.com/tbraun96/heic-rs) test corpus
(`tests/fixtures`, `main` branch, downloaded 16 Nov 2026). They are
**not** produced by this engine's own encoder, so decoding them proves
interoperability with an independent, real-world encoder.

Licence: **MIT OR Apache-2.0**, same as the `heic-rs` crate
(see that repo's `tests/fixtures/README.md`).

| File | Dimensions | What it depicts | Structure |
|---|---|---|---|
| `flat-64.heic` | 64x64 | Solid RGB (200,30,60) | single `hvc1` item |
| `checker-64.heic` | 64x64 | 8px black/white checkerboard | single `hvc1` item |
| `rgb-strips-96.heic` | 96x32 | Red / green / blue vertical strips | single `hvc1` item |
| `gradient-512.heic` | 512x512 | Red ramps left-right, green top-bottom, blue 128 | single `hvc1` item |
| `checker-1024.heic` | 1024x1024 | 64px black/white checkerboard | `grid`, 2x2 tiles of 512x512 |
| `photo-2048.heic` | 2048x1536 | Smooth synthetic multi-colour field | `grid`, 3 rows x 4 cols of 512x512 |

Each small `.heic` has a matching `.ref.png`: **Apple's own decode** of
that file (via `sips -s format png`), which is the ground truth the
unit tests compare against. HEVC is lossy and the pipeline is 4:2:0,
so the tests allow a small mean absolute error (measured MAE 0.0-0.8
against the reference on this machine) rather than pixel equality.
No fixture has alpha; none has a non-zero `irot`/`imir`.
