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
//! * [`conversion`] — the document conversion registry: which
//!   Office/PDF conversions exist, what runs them, where they run.

/// Engine-wide dimension limit, shared by every crate so the value
/// cannot drift between the registry, the security layer and the CLI.
pub const MAX_DIMENSION: u32 = 16_384;

pub mod capability;
pub mod conversion;
pub mod discovery;
pub mod format;

pub use capability::FormatCapability;
pub use conversion::{
    conversion_targets, find_conversion, libreoffice_filter, ConversionEngine, DocumentConversion,
    RunsWhere, DOCUMENT_CONVERSIONS,
};
pub use discovery::{discover, Confidence, DetectionMethod, DiscoveryResult};
pub use format::{detect_format, ImageFormat};
