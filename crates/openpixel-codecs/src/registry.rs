use crate::image_rs::ImageRsCodec;
use crate::planned::planned_capabilities;
use crate::traits::Codec;
use openpixel_formats::{FormatCapability, ImageFormat};

/// The dynamic codec registry. Phase 1 had a hard-coded `registry()`
/// list; Phase 2 builds the list from the codecs actually registered,
/// so adding a codec (or removing one) changes what the application
/// offers — with no change to the engine or the UI.
///
/// Registering a codec for a format that already has one *replaces*
/// it: that is how a native codec (Phase 3) will supersede the
/// pure-Rust adapter for the same format.
pub struct CodecRegistry {
    codecs: Vec<Box<dyn Codec>>,
    planned: Vec<FormatCapability>,
}

impl Default for CodecRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

impl CodecRegistry {
    pub fn new() -> Self {
        Self {
            codecs: Vec::new(),
            planned: planned_capabilities(),
        }
    }

    /// The standard Phase 2 registry: image-rs adapters for the 10
    /// implemented formats + the 11 planned entries.
    pub fn with_image_rs_defaults() -> Self {
        let mut r = Self::new();
        for codec in ImageRsCodec::all() {
            r.register(Box::new(codec));
        }
        r
    }

    /// The standard Phase 3 registry: the image-rs adapters plus the
    /// native codecs (SVG, AVIF, JXL, HDR, EXR, JPEG 2000). The
    /// planned list shrinks as formats move from planned to
    /// implemented — see `planned_capabilities()`.
    ///
    /// HEIC/HEIF follow-up (16 Nov 2026): `HeicCodec` / `HeifCodec`
    /// (pure-Rust heifer) replace the planned HEIC/HEIF entries.
    pub fn with_defaults() -> Self {
        let mut r = Self::with_image_rs_defaults();
        r.register(Box::new(crate::SvgCodec));
        // AVIF needs the native libdav1d decoder: absent from a
        // dav1d-free (wasm32) build, where the planned list below
        // reports it as unavailable instead.
        #[cfg(feature = "native-avif")]
        r.register(Box::new(crate::AvifCodec));
        r.register(Box::new(crate::JxlCodec));
        r.register(Box::new(crate::HdrCodec));
        r.register(Box::new(crate::ExrCodec));
        r.register(Box::new(crate::Jpeg2000Codec));
        r.register(Box::new(crate::HeicCodec));
        r.register(Box::new(crate::HeifCodec));
        r
    }

    pub fn register(&mut self, codec: Box<dyn Codec>) {
        let format = codec.format();
        if let Some(slot) = self.codecs.iter_mut().find(|c| c.format() == format) {
            *slot = codec;
        } else {
            self.codecs.push(codec);
        }
    }

    /// Remove a codec. Returns true if one was registered.
    /// Used by tests and by future plugin unloading — not by the CLI.
    pub fn remove(&mut self, format: ImageFormat) -> bool {
        let before = self.codecs.len();
        self.codecs.retain(|c| c.format() != format);
        self.codecs.len() != before
    }

    pub fn get(&self, format: ImageFormat) -> Option<&dyn Codec> {
        self.codecs
            .iter()
            .find(|c| c.format() == format)
            .map(|c| c.as_ref())
    }

    pub fn contains(&self, format: ImageFormat) -> bool {
        self.get(format).is_some()
    }

    pub fn registered_formats(&self) -> Vec<ImageFormat> {
        self.codecs.iter().map(|c| c.format()).collect()
    }

    pub fn can_decode(&self, format: ImageFormat) -> bool {
        self.get(format)
            .map(|c| c.capability().can_decode)
            .unwrap_or(false)
    }

    pub fn can_encode(&self, format: ImageFormat) -> bool {
        self.get(format)
            .map(|c| c.capability().can_encode)
            .unwrap_or(false)
    }

    /// Capabilities for every format the registry knows: implemented
    /// codecs first (in registration order), then planned entries.
    /// This is what the UI/CLI generate their format lists from.
    pub fn capabilities(&self) -> Vec<FormatCapability> {
        let mut out: Vec<FormatCapability> = self.codecs.iter().map(|c| c.capability()).collect();
        out.extend(self.planned.iter().cloned());
        out
    }

    pub fn capability(&self, format: ImageFormat) -> Option<FormatCapability> {
        self.capabilities()
            .into_iter()
            .find(|c| c.format_id == format.id())
    }

    pub fn implemented_formats(&self) -> Vec<FormatCapability> {
        self.capabilities()
            .into_iter()
            .filter(|c| c.can_decode && c.can_encode)
            .collect()
    }

    pub fn planned_formats(&self) -> Vec<FormatCapability> {
        self.planned.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CodecResult;
    use crate::traits::{Decoder, Encoder};
    use crate::types::{DecodedImage, EncodeParams, PixelFormat};

    /// A minimal custom codec, proving the registry is dynamic: a
    /// third party can register a codec without touching the engine.
    struct OnePixelCodec;

    impl Decoder for OnePixelCodec {
        fn format(&self) -> ImageFormat {
            ImageFormat::Qoi
        }
        fn decode(&self, _bytes: &[u8]) -> CodecResult<DecodedImage> {
            Ok(DecodedImage {
                width: 1,
                height: 1,
                pixel_format: PixelFormat::Rgb8,
                data: vec![255, 0, 0],
                is_animated: false,
                frame_count: None,
                note: Some("test codec".to_string()),
            })
        }
    }

    impl Encoder for OnePixelCodec {
        fn encode(&self, _image: &DecodedImage, _params: &EncodeParams) -> CodecResult<Vec<u8>> {
            Ok(b"qoif-test".to_vec())
        }
    }

    impl Codec for OnePixelCodec {
        fn capability(&self) -> FormatCapability {
            FormatCapability::new(
                "qoi",
                vec!["qoi"],
                vec!["image/qoi"],
                true,
                true,
                true,
                false,
                false,
                false,
                false,
                "test codec",
                "MIT",
                "test",
                16_384,
            )
        }
    }

    #[test]
    fn default_registry_has_eighteen_codecs_and_three_planned() {
        // HEIC/HEIF follow-up (16 Nov 2026): 10 image-rs adapters +
        // 8 native codecs (SVG, AVIF, JXL, HDR, EXR, JPEG 2000, HEIC,
        // HEIF). SVG is decode-only, so it is registered but not in
        // `implemented_formats()` (which counts decode+encode).
        // 3 formats stay planned (APNG, RAW, PSD); total capabilities
        // stay 21.
        //
        // WASM (follow-up item 2): without the `native-avif` feature
        // the AVIF codec is not registered — it moves to the planned
        // list (17 codecs, 16 implemented, 4 planned), and the total
        // capability count still stays 21, so the UI never loses the
        // format, it just reports it as unavailable in that build.
        let r = CodecRegistry::default();
        #[cfg(feature = "native-avif")]
        {
            assert_eq!(r.registered_formats().len(), 18);
            assert_eq!(r.implemented_formats().len(), 17);
            assert_eq!(r.planned_formats().len(), 3);
            assert!(r.can_decode(ImageFormat::Avif));
            assert!(r.can_encode(ImageFormat::Avif));
        }
        #[cfg(not(feature = "native-avif"))]
        {
            assert_eq!(r.registered_formats().len(), 17);
            assert_eq!(r.implemented_formats().len(), 16);
            assert_eq!(r.planned_formats().len(), 4);
            assert!(!r.can_decode(ImageFormat::Avif));
            assert!(!r.can_encode(ImageFormat::Avif));
            assert_eq!(
                r.capability(ImageFormat::Avif).unwrap().status,
                "not available in this build — AVIF needs the native libdav1d decoder (feature `native-avif`); use the native CLI or desktop app"
            );
        }
        assert_eq!(r.capabilities().len(), 21);
        assert!(r.can_decode(ImageFormat::Png));
        assert!(r.can_encode(ImageFormat::Jpeg));
        assert!(r.can_decode(ImageFormat::Svg));
        assert!(!r.can_encode(ImageFormat::Svg));
        assert!(r.can_decode(ImageFormat::Heic));
        assert!(r.can_encode(ImageFormat::Heic));
        assert!(r.can_decode(ImageFormat::Heif));
        assert!(r.can_encode(ImageFormat::Heif));
    }

    #[test]
    fn register_replaces_and_remove_unregisters() {
        let mut r = CodecRegistry::default();
        let base_codecs = r.registered_formats().len();
        let base_caps = r.capabilities().len();
        r.register(Box::new(OnePixelCodec));
        // Still the same codec count — QOI was replaced, not duplicated.
        assert_eq!(r.registered_formats().len(), base_codecs);
        assert_eq!(
            r.get(ImageFormat::Qoi)
                .unwrap()
                .capability()
                .native_dependency,
            "test codec"
        );
        assert!(r.remove(ImageFormat::Jpeg));
        assert!(!r.can_decode(ImageFormat::Jpeg));
        assert_eq!(r.capabilities().len(), base_caps - 1);
        assert!(!r.remove(ImageFormat::Jpeg));
    }

    #[test]
    fn custom_codec_decodes_through_registry() {
        let mut r = CodecRegistry::default();
        r.register(Box::new(OnePixelCodec));
        let img = r
            .get(ImageFormat::Qoi)
            .unwrap()
            .decode(b"anything")
            .unwrap();
        assert_eq!((img.width, img.height), (1, 1));
        assert_eq!(img.data, vec![255, 0, 0]);
    }
}
