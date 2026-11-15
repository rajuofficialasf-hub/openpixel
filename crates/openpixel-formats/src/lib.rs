//! openpixel-formats — format identity, detection and discovery.
//!
//! Pure data, no codec dependency. Every other crate depends on this
//! one to name a format; none of them can invent a format of its own.
//!
//! * [`ImageFormat`] — the format enum, extensions, MIME types.
//! * [`detect_format`] — magic-byte detection (signature only).
//! * [`discovery::discover`] — signature first, extension/MIME only
//!   as a low-confidence fallback, with mismatch reporting.
//! * [`FormatCapability`] — what a format can do *in this build*.

/// Engine-wide dimension limit, shared by every crate so the value
/// cannot drift between the registry, the security layer and the CLI.
pub const MAX_DIMENSION: u32 = 16_384;

pub mod capability;
pub mod discovery;
pub mod format;

pub use capability::FormatCapability;
pub use discovery::{discover, Confidence, DetectionMethod, DiscoveryResult};
pub use format::{detect_format, ImageFormat};
