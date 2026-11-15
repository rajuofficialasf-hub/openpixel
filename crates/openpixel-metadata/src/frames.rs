//! Animation frames and multi-page images.
//!
//! * GIF — full enumeration (count, per-frame delay, disposal, loop
//!   count) and frame extraction with correct compositing, via the
//!   `gif` crate (0.14, pure Rust, already a transitive dep).
//! * APNG / animated WebP — frame information from the container
//!   headers (counts + delays). Only the first frame is decodable
//!   in Phase 5; extracting a later APNG/WebP frame is an honest
//!   error, not a silent first-frame substitution.
//! * TIFF — page count from the IFD chain, page extraction via the
//!   `tiff` crate (0.11, pure Rust, already a transitive dep).

use crate::error::{MetadataError, MetadataResult};
use crate::types::{AnimationInfo, FrameInfo};
use openpixel_codecs::{DecodedImage, PixelFormat};
use std::io::Cursor;

/// Maximum frames a GIF / APNG / animated-WebP scan will enumerate
/// (Phase 9). A file under the engine's 100 MiB limit can otherwise
/// carry millions of tiny frames, growing the `FrameInfo` vec (and
/// the scan time) without bound. 100 000 frames is far beyond any
/// real animation; past it the scan stops and the note says so.
const MAX_SCANNED_FRAMES: u32 = 100_000;

/// Maximum GIF canvas pixels (same 100 MP as the engine's
/// decompression-bomb guard). The GIF header allows 65 535 x 65 535,
/// whose 17 GiB RGBA canvas would be allocated *before* the engine
/// ever saw the dimensions — so the check lives here, before the
/// allocation. Fixed in Phase 9.
const MAX_GIF_CANVAS_PIXELS: u64 = 100_000_000;

/// Frame information for one file's bytes, whatever its format.
/// Non-animated formats return a single-frame `AnimationInfo`.
pub fn animation_info(bytes: &[u8], format: openpixel_formats::ImageFormat) -> AnimationInfo {
    use openpixel_formats::ImageFormat as F;
    match format {
        F::Gif => gif_animation(bytes).unwrap_or_else(|e| AnimationInfo {
            format: "gif".to_string(),
            is_animated: false,
            frame_count: 0,
            loop_count: None,
            frames: vec![],
            note: Some(format!("GIF frame scan failed: {e}")),
        }),
        F::Png => apng_info(bytes),
        F::Webp => webp_animation_info(bytes),
        F::Tiff => {
            let count = tiff_page_count(bytes).unwrap_or(0);
            let (w, h) = tiff_dimensions(bytes).unwrap_or((0, 0));
            AnimationInfo {
                format: "tiff".to_string(),
                is_animated: count > 1,
                frame_count: count,
                loop_count: None,
                frames: (0..count)
                    .map(|i| FrameInfo {
                        index: i,
                        width: w,
                        height: h,
                        offset_x: 0,
                        offset_y: 0,
                        delay_ms: None,
                        disposal: None,
                    })
                    .collect(),
                note: if count > 1 {
                    Some("multi-page TIFF: every page is extractable".to_string())
                } else {
                    None
                },
            }
        }
        _ => AnimationInfo::single(format.id(), 0, 0),
    }
}

// ---- GIF ------------------------------------------------------------------

fn gif_repeat_to_loop_count(repeat: gif::Repeat) -> Option<u32> {
    match repeat {
        gif::Repeat::Finite(n) => Some(u32::from(n)),
        gif::Repeat::Infinite => Some(0),
    }
}

pub fn gif_animation(bytes: &[u8]) -> MetadataResult<AnimationInfo> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options
        .read_info(Cursor::new(bytes))
        .map_err(|e| MetadataError::InvalidInput(format!("GIF decode failed: {e}")))?;
    let loop_count = gif_repeat_to_loop_count(decoder.repeat());
    let canvas_w = u32::from(decoder.width());
    let canvas_h = u32::from(decoder.height());
    let mut frames = Vec::new();
    let mut index = 0u32;
    let mut capped = false;
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| MetadataError::InvalidInput(format!("GIF frame {index} failed: {e}")))?
    {
        if index >= MAX_SCANNED_FRAMES {
            capped = true;
            break;
        }
        frames.push(FrameInfo {
            index,
            width: u32::from(frame.width),
            height: u32::from(frame.height),
            offset_x: u32::from(frame.left),
            offset_y: u32::from(frame.top),
            delay_ms: Some(u32::from(frame.delay) * 10),
            disposal: Some(disposal_to_u8(frame.dispose)),
        });
        index += 1;
    }
    if frames.is_empty() {
        return Err(MetadataError::NoFrames(
            "GIF contains no image frames".to_string(),
        ));
    }
    Ok(AnimationInfo {
        format: "gif".to_string(),
        is_animated: frames.len() > 1,
        frame_count: frames.len() as u32,
        loop_count,
        frames,
        note: Some(if capped {
            format!(
                "GIF {canvas_w}x{canvas_h} canvas: every frame is extractable (frame scan stopped at the {MAX_SCANNED_FRAMES}-frame cap)"
            )
        } else {
            format!("GIF {canvas_w}x{canvas_h} canvas: every frame is extractable")
        }),
    })
}

fn disposal_to_u8(dispose: gif::DisposalMethod) -> u8 {
    match dispose {
        gif::DisposalMethod::Any => 0,
        gif::DisposalMethod::Keep => 1,
        gif::DisposalMethod::Background => 2,
        gif::DisposalMethod::Previous => 3,
    }
}

/// Extract GIF frame `index` as a full-canvas RGBA8 image,
/// compositing all frames up to it and honouring each frame's
/// disposal method — so a partial frame that only paints a corner
/// still yields the picture a viewer would see at that moment.
pub fn extract_gif_frame(bytes: &[u8], index: u32) -> MetadataResult<DecodedImage> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options
        .read_info(Cursor::new(bytes))
        .map_err(|e| MetadataError::InvalidInput(format!("GIF decode failed: {e}")))?;
    let width = u32::from(decoder.width());
    let height = u32::from(decoder.height());
    if width == 0 || height == 0 {
        return Err(MetadataError::InvalidInput(
            "GIF canvas is empty".to_string(),
        ));
    }
    // Check BEFORE allocating the canvas: a 65 535 x 65 535 header
    // would otherwise ask for a ~17 GiB RGBA buffer (Phase 9).
    if width as u64 * height as u64 > MAX_GIF_CANVAS_PIXELS {
        return Err(MetadataError::InvalidInput(format!(
            "GIF canvas {width}x{height} exceeds the {MAX_GIF_CANVAS_PIXELS} pixel limit"
        )));
    }
    let mut canvas = vec![0u8; (width * height * 4) as usize];
    // Snapshot kept for DisposalMethod::Previous.
    let mut previous_snapshot: Option<Vec<u8>> = None;
    // The previous frame's rect + disposal, applied before the next
    // frame is drawn.
    let mut pending: Option<(u16, u16, u16, u16, gif::DisposalMethod)> = None;
    let mut current = 0u32;
    loop {
        if current >= MAX_SCANNED_FRAMES && current != index {
            return Err(MetadataError::FrameOutOfRange {
                index,
                count: current,
            });
        }
        let Some(frame) = decoder
            .read_next_frame()
            .map_err(|e| MetadataError::InvalidInput(format!("GIF frame {current} failed: {e}")))?
        else {
            return Err(MetadataError::FrameOutOfRange {
                index,
                count: current,
            });
        };
        // Apply the previous frame's disposal before drawing this one.
        if let Some((left, top, w, h, dispose)) = pending.take() {
            match dispose {
                gif::DisposalMethod::Background => {
                    clear_rect(&mut canvas, width, left, top, w, h);
                }
                gif::DisposalMethod::Previous => {
                    if let Some(snapshot) = previous_snapshot.take() {
                        canvas = snapshot;
                    }
                }
                _ => {}
            }
        }
        if frame.dispose == gif::DisposalMethod::Previous {
            previous_snapshot = Some(canvas.clone());
        }
        draw_frame(&mut canvas, width, height, frame);
        if current == index {
            return Ok(DecodedImage {
                width,
                height,
                pixel_format: PixelFormat::Rgba8,
                data: canvas,
                is_animated: true,
                frame_count: None,
                note: Some(format!("GIF frame {index} composited onto the canvas")),
            });
        }
        pending = Some((
            frame.left,
            frame.top,
            frame.width,
            frame.height,
            frame.dispose,
        ));
        current += 1;
    }
}

fn clear_rect(canvas: &mut [u8], canvas_w: u32, left: u16, top: u16, w: u16, h: u16) {
    let (left, top, w, h) = (u32::from(left), u32::from(top), u32::from(w), u32::from(h));
    let canvas_h = (canvas.len() / 4) as u32 / canvas_w.max(1);
    for y in top..(top + h).min(canvas_h) {
        for x in left..(left + w).min(canvas_w) {
            let i = ((y * canvas_w + x) * 4) as usize;
            canvas[i..i + 4].copy_from_slice(&[0, 0, 0, 0]);
        }
    }
}

/// Source-over composite of one GIF frame's RGBA buffer onto the
/// canvas at the frame's offset. Fully transparent source pixels
/// leave the canvas untouched.
fn draw_frame(canvas: &mut [u8], canvas_w: u32, canvas_h: u32, frame: &gif::Frame<'_>) {
    let (fw, fh) = (u32::from(frame.width), u32::from(frame.height));
    let (left, top) = (u32::from(frame.left), u32::from(frame.top));
    for y in 0..fh {
        let cy = top + y;
        if cy >= canvas_h {
            break;
        }
        for x in 0..fw {
            let cx = left + x;
            if cx >= canvas_w {
                break;
            }
            let si = ((y * fw + x) * 4) as usize;
            let di = ((cy * canvas_w + cx) * 4) as usize;
            let src = [
                frame.buffer[si],
                frame.buffer[si + 1],
                frame.buffer[si + 2],
                frame.buffer[si + 3],
            ];
            if src[3] == 0 {
                continue;
            }
            if src[3] == 255 {
                canvas[di..di + 4].copy_from_slice(&src);
            } else {
                let sa = src[3] as f32 / 255.0;
                for i in 0..3 {
                    let v = src[i] as f32 * sa + canvas[di + i] as f32 * (1.0 - sa);
                    canvas[di + i] = v.round().clamp(0.0, 255.0) as u8;
                }
                canvas[di + 3] = 255;
            }
        }
    }
}

// ---- APNG -----------------------------------------------------------------

/// APNG frame info from the PNG chunk stream (`acTL` / `fcTL`).
/// A plain PNG (no `acTL`) is a single static frame.
pub fn apng_info(bytes: &[u8]) -> AnimationInfo {
    let mut frames: Vec<FrameInfo> = Vec::new();
    let mut num_frames: Option<u32> = None;
    let mut num_plays: Option<u32> = None;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut pos = 8usize;
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]])
            as usize;
        let chunk_type = &bytes[pos + 4..pos + 8];
        let data_start = pos + 8;
        let Some(data) = bytes.get(data_start..data_start.saturating_add(len)) else {
            break;
        };
        match chunk_type {
            b"IHDR" if data.len() >= 8 => {
                width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
            }
            b"acTL" if data.len() >= 8 => {
                num_frames = Some(u32::from_be_bytes([data[0], data[1], data[2], data[3]]));
                num_plays = Some(u32::from_be_bytes([data[4], data[5], data[6], data[7]]));
            }
            b"fcTL" if data.len() >= 26 => {
                // Stop at the scan cap, and never record more frames
                // than acTL declared (extra fcTL chunks are corrupt).
                if frames.len() >= MAX_SCANNED_FRAMES as usize
                    || num_frames.is_some_and(|n| frames.len() >= n as usize)
                {
                    break;
                }
                let w = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                let h = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
                let x = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
                let y = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
                let delay_num = u16::from_be_bytes([data[20], data[21]]) as u32;
                let mut delay_den = u16::from_be_bytes([data[22], data[23]]) as u32;
                if delay_den == 0 {
                    delay_den = 100;
                }
                let delay_ms = Some(delay_num * 1000 / delay_den);
                let dispose_op = data[24];
                frames.push(FrameInfo {
                    index: frames.len() as u32,
                    width: w,
                    height: h,
                    offset_x: x,
                    offset_y: y,
                    delay_ms,
                    disposal: Some(dispose_op),
                });
            }
            b"IEND" => break,
            _ => {}
        }
        let Some(next) = data_start.checked_add(len).and_then(|e| e.checked_add(4)) else {
            break;
        };
        if next > bytes.len() {
            break;
        }
        pos = next;
    }
    match num_frames {
        Some(count) if count > 0 => AnimationInfo {
            format: "png".to_string(),
            is_animated: true,
            frame_count: count,
            loop_count: num_plays,
            frames,
            note: Some(
                "APNG: frame info only in Phase 5 — only the first frame is decodable; extracting a later APNG frame is not supported".to_string(),
            ),
        },
        _ => AnimationInfo::single("png", width, height),
    }
}

// ---- Animated WebP ----------------------------------------------------------

/// Animated WebP frame info from `VP8X` / `ANMF` chunks.
pub fn webp_animation_info(bytes: &[u8]) -> AnimationInfo {
    let mut frames: Vec<FrameInfo> = Vec::new();
    let mut animated_flag = false;
    let mut canvas_w = 0u32;
    let mut canvas_h = 0u32;
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return AnimationInfo::single("webp", 0, 0);
    }
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let fourcc = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let data_start = pos + 8;
        let Some(data) = bytes.get(data_start..data_start.saturating_add(size)) else {
            break;
        };
        match fourcc {
            b"VP8X" if data.len() >= 10 => {
                animated_flag = data[0] & 0x02 != 0;
                canvas_w = u24_le(&data[4..7]) + 1;
                canvas_h = u24_le(&data[7..10]) + 1;
            }
            b"ANMF" if data.len() >= 16 => {
                // Stop at the scan cap (Phase 9): ANMF chunks are
                // otherwise unbounded in a crafted file.
                if frames.len() >= MAX_SCANNED_FRAMES as usize {
                    break;
                }
                let x = u24_le(&data[0..3]) * 2;
                let y = u24_le(&data[3..6]) * 2;
                let w = u24_le(&data[6..9]) + 1;
                let h = u24_le(&data[9..12]) + 1;
                let duration_ms = Some(u24_le(&data[12..15]));
                let flags = data[15];
                let disposal = Some((flags >> 1) & 0x01);
                frames.push(FrameInfo {
                    index: frames.len() as u32,
                    width: w,
                    height: h,
                    offset_x: x,
                    offset_y: y,
                    delay_ms: duration_ms,
                    disposal,
                });
            }
            _ => {}
        }
        let Some(next) = data_start.checked_add(size + (size % 2)) else {
            break;
        };
        pos = next;
    }
    if !animated_flag && frames.is_empty() {
        return AnimationInfo::single("webp", canvas_w, canvas_h);
    }
    AnimationInfo {
        format: "webp".to_string(),
        is_animated: true,
        frame_count: frames.len() as u32,
        loop_count: None,
        frames,
        note: Some(
            "Animated WebP: frame info only in Phase 5 — only the first frame is decodable; extracting a later WebP frame is not supported".to_string(),
        ),
    }
}

fn u24_le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], 0])
}

// ---- TIFF -------------------------------------------------------------------

/// Count TIFF pages by walking the IFD chain. Bounded (10 000
/// pages, repeated-offset guard) so a corrupt chain cannot loop
/// forever.
pub fn tiff_page_count(bytes: &[u8]) -> MetadataResult<u32> {
    if bytes.len() < 8 || (&bytes[..2] != b"II" && &bytes[..2] != b"MM") {
        return Err(MetadataError::InvalidInput(
            "not a TIFF (bad byte-order mark)".to_string(),
        ));
    }
    let le = &bytes[..2] == b"II";
    let u32_at = |off: usize| -> Option<u32> {
        let b = bytes.get(off..off + 4)?;
        Some(if le {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        })
    };
    let u16_at = |off: usize| -> Option<u16> {
        let b = bytes.get(off..off + 2)?;
        Some(if le {
            u16::from_le_bytes([b[0], b[1]])
        } else {
            u16::from_be_bytes([b[0], b[1]])
        })
    };
    let mut count = 0u32;
    let mut next = u32_at(4).unwrap_or(0) as usize;
    let mut seen = std::collections::HashSet::new();
    while next != 0 && count < 10_000 {
        if !seen.insert(next) {
            break; // Cycle in the chain — corrupt file.
        }
        let entries = u16_at(next).ok_or_else(|| {
            MetadataError::InvalidInput("TIFF IFD offset is out of bounds".to_string())
        })? as usize;
        // The IFD structure itself (count + entries + next pointer)
        // must fit inside the file; a count that runs past the end
        // is corruption, not a page.
        let ifd_bytes = 2usize
            .checked_add(entries.checked_mul(12).ok_or_else(|| {
                MetadataError::InvalidInput("TIFF IFD entry count overflows".to_string())
            })?)
            .and_then(|n| n.checked_add(4))
            .ok_or_else(|| {
                MetadataError::InvalidInput("TIFF IFD entry count overflows".to_string())
            })?;
        if next
            .checked_add(ifd_bytes)
            .is_none_or(|end| end > bytes.len())
        {
            return Err(MetadataError::InvalidInput(
                "TIFF IFD extends past the end of the file".to_string(),
            ));
        }
        let next_off = next
            .checked_add(2)
            .and_then(|o| o.checked_add(entries.checked_mul(12)?))
            .and_then(u32_at)
            .unwrap_or(0);
        count += 1;
        next = next_off as usize;
    }
    Ok(count)
}

fn tiff_dimensions(bytes: &[u8]) -> MetadataResult<(u32, u32)> {
    use std::io::Cursor;
    let mut decoder = tiff::decoder::Decoder::new(Cursor::new(bytes))
        .map_err(|e| MetadataError::InvalidInput(format!("TIFF decode failed: {e}")))?;
    decoder
        .dimensions()
        .map_err(|e| MetadataError::InvalidInput(format!("TIFF dimensions failed: {e}")))
}

/// Extract TIFF page `index` as a `DecodedImage`. 8/16-bit
/// grey/RGB/RGBA are supported; CMYK, palette-16 and float pages
/// are an honest error in Phase 5.
pub fn extract_tiff_page(bytes: &[u8], index: u32) -> MetadataResult<DecodedImage> {
    let count = tiff_page_count(bytes)?;
    if index >= count {
        return Err(MetadataError::FrameOutOfRange { index, count });
    }
    let mut decoder = tiff::decoder::Decoder::new(Cursor::new(bytes))
        .map_err(|e| MetadataError::InvalidInput(format!("TIFF decode failed: {e}")))?;
    decoder
        .seek_to_image(index as usize)
        .map_err(|e| MetadataError::InvalidInput(format!("TIFF page {index} seek failed: {e}")))?;
    let (width, height) = decoder.dimensions().map_err(|e| {
        MetadataError::InvalidInput(format!("TIFF page {index} dimensions failed: {e}"))
    })?;
    // Check BEFORE read_image allocates the pixels: a header
    // claiming e.g. 100 000 x 100 000 would otherwise ask the TIFF
    // decoder for a multi-gigabyte buffer (Phase 9). Same limits as
    // the engine (16 384 px / side, 100 MP).
    if width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || width as u64 * height as u64 > 100_000_000
    {
        return Err(MetadataError::InvalidInput(format!(
            "TIFF page {index} is {width}x{height}, exceeding the 16384 px / 100 MP limits"
        )));
    }
    let color_type = decoder.colortype().map_err(|e| {
        MetadataError::InvalidInput(format!("TIFF page {index} colour type failed: {e}"))
    })?;
    let result = decoder.read_image().map_err(|e| {
        MetadataError::InvalidInput(format!("TIFF page {index} decode failed: {e}"))
    })?;
    let (pixel_format, data) = match (color_type, result) {
        (tiff::ColorType::Gray(8), tiff::decoder::DecodingResult::U8(data)) => {
            (PixelFormat::Luma8, data)
        }
        (tiff::ColorType::GrayA(8), tiff::decoder::DecodingResult::U8(data)) => {
            (PixelFormat::LumaAlpha8, data)
        }
        (tiff::ColorType::RGB(8), tiff::decoder::DecodingResult::U8(data)) => {
            (PixelFormat::Rgb8, data)
        }
        (tiff::ColorType::RGBA(8), tiff::decoder::DecodingResult::U8(data)) => {
            (PixelFormat::Rgba8, data)
        }
        (tiff::ColorType::Gray(16), tiff::decoder::DecodingResult::U16(data)) => {
            // No Luma16 in the canonical type: widen grey to RGB16.
            let rgb16: Vec<u8> = data
                .iter()
                .flat_map(|v| {
                    let b = v.to_ne_bytes();
                    [b[0], b[1], b[0], b[1], b[0], b[1]]
                })
                .collect();
            (PixelFormat::Rgb16, rgb16)
        }
        (tiff::ColorType::RGB(16), tiff::decoder::DecodingResult::U16(data)) => (
            PixelFormat::Rgb16,
            data.iter().flat_map(|v| v.to_ne_bytes()).collect(),
        ),
        (tiff::ColorType::RGBA(16), tiff::decoder::DecodingResult::U16(data)) => (
            PixelFormat::Rgba16,
            data.iter().flat_map(|v| v.to_ne_bytes()).collect(),
        ),
        (ct, _) => {
            return Err(MetadataError::Unsupported(format!(
                "TIFF page {index} has colour type {ct:?}, not supported in Phase 5"
            )));
        }
    };
    Ok(DecodedImage {
        width,
        height,
        pixel_format,
        data,
        is_animated: count > 1,
        frame_count: Some(count),
        note: if count > 1 {
            Some(format!("TIFF page {index} of {count}"))
        } else {
            None
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{
        build_tiff_pages, longs, png_with_chunks, shorts, webp_with_chunks, TiffEntry, TiffPayload,
    };

    /// 4x4 GIF, 3 full frames (red, green, blue), delays 10/20/30
    /// centiseconds, looping forever.
    fn three_frame_gif() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = gif::Encoder::new(&mut out, 4, 4, &[]).unwrap();
        encoder.set_repeat(gif::Repeat::Infinite).unwrap();
        for (colour, delay) in [
            ([255, 0, 0, 255], 10u16),
            ([0, 255, 0, 255], 20),
            ([0, 0, 255, 255], 30),
        ] {
            let mut pixels = Vec::new();
            for _ in 0..16 {
                pixels.extend_from_slice(&colour);
            }
            let mut frame = gif::Frame::from_rgba(4, 4, &mut pixels);
            frame.delay = delay;
            encoder.write_frame(&frame).unwrap();
        }
        drop(encoder);
        out
    }

    #[test]
    fn gif_frame_count_delays_and_loop() {
        let info = gif_animation(&three_frame_gif()).unwrap();
        assert!(info.is_animated);
        assert_eq!(info.frame_count, 3);
        assert_eq!(info.loop_count, Some(0)); // 0 = forever
        assert_eq!(
            info.frames.iter().map(|f| f.delay_ms).collect::<Vec<_>>(),
            vec![Some(100), Some(200), Some(300)]
        );
        assert_eq!((info.frames[0].width, info.frames[0].height), (4, 4));
    }

    #[test]
    fn gif_frame_extraction_returns_each_frames_colours() {
        let bytes = three_frame_gif();
        for (index, expected) in [
            (0u32, [255, 0, 0, 255]),
            (1, [0, 255, 0, 255]),
            (2, [0, 0, 255, 255]),
        ] {
            let img = extract_gif_frame(&bytes, index).unwrap();
            assert_eq!((img.width, img.height), (4, 4));
            assert_eq!(img.pixel_format, PixelFormat::Rgba8);
            assert_eq!(&img.data[0..4], &expected, "frame {index}");
            assert!(img.data.as_chunks::<4>().0.iter().all(|px| *px == expected));
        }
    }

    #[test]
    fn gif_frame_out_of_range_is_an_error() {
        let bytes = three_frame_gif();
        assert!(matches!(
            extract_gif_frame(&bytes, 3),
            Err(MetadataError::FrameOutOfRange { index: 3, count: 3 })
        ));
    }

    /// Frame 0: full blue canvas. Frame 1: 2x2 red square at (1,1).
    /// Extracting frame 1 must show the red square over blue.
    fn partial_frame_gif() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = gif::Encoder::new(&mut out, 4, 4, &[]).unwrap();
        let mut blue = vec![0u8; 4 * 4 * 4];
        for px in blue.as_chunks_mut::<4>().0 {
            px.copy_from_slice(&[0, 0, 255, 255]);
        }
        let mut frame = gif::Frame::from_rgba(4, 4, &mut blue);
        frame.delay = 10;
        encoder.write_frame(&frame).unwrap();
        let mut red = vec![0u8; 2 * 2 * 4];
        for px in red.as_chunks_mut::<4>().0 {
            px.copy_from_slice(&[255, 0, 0, 255]);
        }
        // from_rgba builds the local palette; overriding the offset
        // afterwards keeps the frame partial.
        let mut frame = gif::Frame::from_rgba(2, 2, &mut red);
        frame.left = 1;
        frame.top = 1;
        frame.delay = 10;
        frame.dispose = gif::DisposalMethod::Keep;
        encoder.write_frame(&frame).unwrap();
        drop(encoder);
        out
    }

    fn rgba_px(img: &DecodedImage, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * img.width + x) * 4) as usize;
        [
            img.data[i],
            img.data[i + 1],
            img.data[i + 2],
            img.data[i + 3],
        ]
    }

    #[test]
    fn gif_partial_frame_composites_over_previous() {
        let img = extract_gif_frame(&partial_frame_gif(), 1).unwrap();
        assert_eq!(rgba_px(&img, 0, 0), [0, 0, 255, 255]);
        assert_eq!(rgba_px(&img, 1, 1), [255, 0, 0, 255]);
        assert_eq!(rgba_px(&img, 2, 2), [255, 0, 0, 255]);
        assert_eq!(rgba_px(&img, 3, 3), [0, 0, 255, 255]);
    }

    /// Frame 1 paints green 2x2 at (0,0) with Background disposal;
    /// frame 2 paints 1x1 white at (3,3). Extracting frame 2 must
    /// show the green rect cleared to transparent.
    fn disposal_gif() -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = gif::Encoder::new(&mut out, 4, 4, &[]).unwrap();
        let mut red = vec![0u8; 4 * 4 * 4];
        for px in red.as_chunks_mut::<4>().0 {
            px.copy_from_slice(&[255, 0, 0, 255]);
        }
        let mut frame = gif::Frame::from_rgba(4, 4, &mut red);
        frame.delay = 10;
        encoder.write_frame(&frame).unwrap();
        let mut green = vec![0u8; 2 * 2 * 4];
        for px in green.as_chunks_mut::<4>().0 {
            px.copy_from_slice(&[0, 255, 0, 255]);
        }
        let mut frame = gif::Frame::from_rgba(2, 2, &mut green);
        frame.delay = 10;
        frame.dispose = gif::DisposalMethod::Background;
        encoder.write_frame(&frame).unwrap();
        let mut white = vec![255u8; 4];
        let mut frame = gif::Frame::from_rgba(1, 1, &mut white);
        frame.left = 3;
        frame.top = 3;
        frame.delay = 10;
        frame.dispose = gif::DisposalMethod::Keep;
        encoder.write_frame(&frame).unwrap();
        drop(encoder);
        out
    }

    #[test]
    fn gif_background_disposal_clears_before_next_frame() {
        let img = extract_gif_frame(&disposal_gif(), 2).unwrap();
        assert_eq!(rgba_px(&img, 0, 0)[3], 0, "disposed rect is transparent");
        assert_eq!(rgba_px(&img, 1, 1)[3], 0);
        assert_eq!(rgba_px(&img, 2, 2), [255, 0, 0, 255], "untouched red stays");
        assert_eq!(rgba_px(&img, 3, 3), [255, 255, 255, 255]);
    }

    #[allow(clippy::too_many_arguments)]
    fn fctl(
        seq: u32,
        w: u32,
        h: u32,
        x: u32,
        y: u32,
        delay_num: u16,
        delay_den: u16,
        dispose: u8,
    ) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&seq.to_be_bytes());
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&x.to_be_bytes());
        v.extend_from_slice(&y.to_be_bytes());
        v.extend_from_slice(&delay_num.to_be_bytes());
        v.extend_from_slice(&delay_den.to_be_bytes());
        v.push(dispose);
        v.push(0); // blend op
        v
    }

    #[test]
    fn apng_frame_info_counts_frames_and_delays() {
        let ihdr = vec![0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0];
        let mut actl = Vec::new();
        actl.extend_from_slice(&2u32.to_be_bytes());
        actl.extend_from_slice(&0u32.to_be_bytes());
        let apng = png_with_chunks(&[
            (b"IHDR", ihdr),
            (b"acTL", actl),
            (b"fcTL", fctl(0, 4, 4, 0, 0, 5, 100, 0)),
            (b"IDAT", vec![0; 8]),
            (b"fcTL", fctl(1, 2, 2, 1, 1, 15, 100, 1)),
            (b"fdAT", vec![0; 8]),
        ]);
        let info = apng_info(&apng);
        assert!(info.is_animated);
        assert_eq!(info.frame_count, 2);
        assert_eq!(info.loop_count, Some(0));
        assert_eq!(info.frames[0].delay_ms, Some(50));
        assert_eq!(info.frames[1].delay_ms, Some(150));
        assert_eq!((info.frames[1].width, info.frames[1].height), (2, 2));
        assert_eq!((info.frames[1].offset_x, info.frames[1].offset_y), (1, 1));
        assert!(info.note.as_deref().unwrap().contains("first frame"));
    }

    #[test]
    fn plain_png_is_a_single_static_frame() {
        let ihdr = vec![0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0];
        let png = png_with_chunks(&[(b"IHDR", ihdr), (b"IDAT", vec![0; 8])]);
        let info = apng_info(&png);
        assert!(!info.is_animated);
        assert_eq!(info.frame_count, 1);
    }

    fn anmf(x: u32, y: u32, w: u32, h: u32, duration_ms: u32) -> Vec<u8> {
        let mut v = Vec::new();
        let u24 = |n: u32| [n as u8, (n >> 8) as u8, (n >> 16) as u8];
        v.extend_from_slice(&u24(x / 2));
        v.extend_from_slice(&u24(y / 2));
        v.extend_from_slice(&u24(w - 1));
        v.extend_from_slice(&u24(h - 1));
        v.extend_from_slice(&u24(duration_ms));
        v.push(0);
        v.extend_from_slice(&[0; 4]); // dummy frame bitstream
        v
    }

    #[test]
    fn webp_animation_info_counts_frames_and_delays() {
        let vp8x = vec![0x02, 0, 0, 0, 3, 0, 0, 3, 0, 0];
        let webp = webp_with_chunks(&[
            (b"VP8X", vp8x),
            (b"ANMF", anmf(0, 0, 4, 4, 100)),
            (b"ANMF", anmf(0, 0, 2, 2, 250)),
        ]);
        let info = webp_animation_info(&webp);
        assert!(info.is_animated);
        assert_eq!(info.frame_count, 2);
        assert_eq!(info.frames[0].delay_ms, Some(100));
        assert_eq!(info.frames[1].delay_ms, Some(250));
        assert_eq!((info.frames[1].width, info.frames[1].height), (2, 2));
        assert!(info.note.as_deref().unwrap().contains("first frame"));
    }

    #[test]
    fn static_webp_is_a_single_frame() {
        let vp8x = vec![0x00, 0, 0, 0, 3, 0, 0, 3, 0, 0];
        let webp = webp_with_chunks(&[(b"VP8X", vp8x)]);
        let info = webp_animation_info(&webp);
        assert!(!info.is_animated);
        assert_eq!(info.frame_count, 1);
    }

    fn gray_page(pixels: Vec<u8>) -> Vec<TiffEntry> {
        vec![
            TiffEntry::raw(256, 4, 1, longs(&[4], true)),
            TiffEntry::raw(257, 4, 1, longs(&[4], true)),
            TiffEntry::raw(258, 3, 1, shorts(&[8], true)),
            TiffEntry::raw(259, 3, 1, shorts(&[1], true)),
            TiffEntry::raw(262, 3, 1, shorts(&[1], true)),
            TiffEntry {
                tag: 273,
                field_type: 4,
                count: 1,
                payload: TiffPayload::OffsetTo(pixels),
            },
            TiffEntry::raw(277, 3, 1, shorts(&[1], true)),
            TiffEntry::raw(278, 4, 1, longs(&[4], true)),
            TiffEntry::raw(279, 4, 1, longs(&[16], true)),
            TiffEntry::raw(284, 3, 1, shorts(&[1], true)),
        ]
    }

    #[test]
    fn tiff_page_count_and_extraction() {
        let bytes = build_tiff_pages(&[gray_page(vec![10; 16]), gray_page(vec![200; 16])], true);
        assert_eq!(tiff_page_count(&bytes).unwrap(), 2);
        let page0 = extract_tiff_page(&bytes, 0).unwrap();
        assert_eq!((page0.width, page0.height), (4, 4));
        assert_eq!(page0.pixel_format, PixelFormat::Luma8);
        assert!(page0.data.iter().all(|&v| v == 10));
        let page1 = extract_tiff_page(&bytes, 1).unwrap();
        assert!(page1.data.iter().all(|&v| v == 200));
        assert!(matches!(
            extract_tiff_page(&bytes, 2),
            Err(MetadataError::FrameOutOfRange { index: 2, count: 2 })
        ));
        let info = animation_info(&bytes, openpixel_formats::ImageFormat::Tiff);
        assert!(info.is_animated);
        assert_eq!(info.frame_count, 2);
    }

    #[test]
    fn corrupt_tiff_page_count_is_an_error_not_a_panic() {
        assert!(tiff_page_count(b"II*\x00\x08\x00\x00\x00\xff\xff").is_err());
        assert!(tiff_page_count(b"not a tiff at all").is_err());
    }

    /// Phase 9: a GIF header claiming a 65 535 x 65 535 canvas must
    /// be rejected before the ~17 GiB RGBA canvas is allocated.
    #[test]
    fn huge_gif_canvas_is_rejected_before_allocation() {
        let mut gif = b"GIF89a".to_vec();
        gif.extend_from_slice(&65_535u16.to_le_bytes()); // width
        gif.extend_from_slice(&65_535u16.to_le_bytes()); // height
        gif.extend_from_slice(&[0, 0, 0]); // packed, bg, aspect
        gif.push(0x3B); // trailer
        assert!(matches!(
            extract_gif_frame(&gif, 0),
            Err(MetadataError::InvalidInput(_))
        ));
    }

    /// Phase 9: a TIFF page whose header claims dimensions over the
    /// limits must be rejected before `read_image` allocates pixels.
    #[test]
    fn huge_tiff_page_is_rejected_before_decode() {
        use crate::test_helpers::{build_tiff, longs, shorts, TiffEntry};
        let bytes = build_tiff(
            &[
                TiffEntry::raw(256, 4, 1, longs(&[20_000], true)),
                TiffEntry::raw(257, 4, 1, longs(&[20_000], true)),
                // PhotometricInterpretation 1 (BlackIsZero), so the
                // tiff decoder accepts the IFD and reaches dimensions().
                TiffEntry::raw(262, 3, 1, shorts(&[1], true)),
                // Strip tags, so the decoder accepts the IFD at all;
                // the offsets point nowhere, but dimensions() is
                // reached before any strip is read.
                TiffEntry::raw(273, 4, 1, longs(&[0], true)),
                TiffEntry::raw(278, 4, 1, longs(&[20_000], true)),
                TiffEntry::raw(279, 4, 1, longs(&[0], true)),
            ],
            true,
        );
        assert_eq!(tiff_page_count(&bytes).unwrap(), 1);
        let err = extract_tiff_page(&bytes, 0).unwrap_err();
        assert!(err.to_string().contains("16384"), "unexpected error: {err}");
    }
}
