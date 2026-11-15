use crate::error::CodecResult;
use crate::types::{DecodedImage, EncodeParams};
use openpixel_formats::{FormatCapability, ImageFormat};

/// Decode one format from bytes into the canonical representation.
/// Object-safe: the registry holds `Box<dyn Codec>`.
pub trait Decoder: Send + Sync {
    fn format(&self) -> ImageFormat;
    fn decode(&self, bytes: &[u8]) -> CodecResult<DecodedImage>;
    /// Dimensions without a full pixel decode, where the codec supports it.
    /// Default implementation decodes fully — adapters override it when
    /// they can read the header cheaply.
    fn dimensions(&self, bytes: &[u8]) -> CodecResult<(u32, u32)> {
        let img = self.decode(bytes)?;
        Ok((img.width, img.height))
    }
}

/// Encode the canonical representation into one format's bytes.
/// The format is reported once, on `Decoder::format` — a codec is
/// one format, so the encoder does not repeat it (and the two can
/// never disagree).
pub trait Encoder: Send + Sync {
    fn encode(&self, image: &DecodedImage, params: &EncodeParams) -> CodecResult<Vec<u8>>;
}

/// A codec is a decoder + encoder + its honest capability report.
/// A format with only a decoder (or only an encoder) implements the
/// other side by returning `CodecError::Unsupported` — the registry
/// then reports `can_decode` / `can_encode` from `capability()`,
/// never from a guess.
pub trait Codec: Decoder + Encoder {
    fn capability(&self) -> FormatCapability;
}
