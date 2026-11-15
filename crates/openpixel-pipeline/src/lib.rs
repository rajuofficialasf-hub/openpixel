//! openpixel-pipeline — composable image processing (Phase 4).
//!
//! A [`Pipeline`] holds an ordered list of [`Operation`]s and applies
//! them in order to a [`DecodedImage`]. It is pure: no file I/O, no
//! format or codec knowledge — the engine decodes, runs the pipeline,
//! then encodes.
//!
//! ```rust
//! use openpixel_codecs::{DecodedImage, PixelFormat};
//! use openpixel_pipeline::{Operation, Pipeline};
//!
//! let img = DecodedImage {
//!     width: 8, height: 6,
//!     pixel_format: PixelFormat::Rgb8,
//!     data: vec![128; 8 * 6 * 3],
//!     is_animated: false, frame_count: None, note: None,
//! };
//! let out = Pipeline::from_operations(vec![
//!     Operation::ResizeFit { width: 4, height: 4 },
//!     Operation::Grayscale,
//! ])
//! .apply(&img)
//! .unwrap();
//! assert_eq!((out.width, out.height), (4, 3));
//! ```
//!
//! Operation order and value ranges are documented on [`Operation`]
//! and [`PipelineSpec`]. Text watermarks are intentionally absent:
//! there is no bundled font in Phase 4 — use the image watermark
//! ([`Operation::Watermark`]) with a PNG logo instead.

pub mod error;
pub mod operation;
pub mod pipeline;
pub mod spec;

pub use error::{PipelineError, PipelineResult};
pub use operation::{Operation, WatermarkPosition, MAX_DIMENSION, MAX_PIXELS};
pub use pipeline::Pipeline;
pub use spec::{PipelineSpec, WatermarkSpec};
