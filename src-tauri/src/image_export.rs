use std::{
    ffi::OsString,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use image::{ExtendedColorType, ImageEncoder, codecs::jpeg::JpegEncoder, codecs::png::PngEncoder};
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;
use webpx::{EncoderConfig, Unstoppable};

const MAX_PAGES: usize = 100;
const MAX_LONG_IMAGE_PIXELS: u64 = 100_000_000;
const MAX_WEBP_AXIS: u32 = 16_383;
const MAX_JPEG_AXIS: u32 = 65_535;
const MIN_PAPER_MM: f64 = 25.4;
const MAX_PAPER_MM: f64 = 2000.0;
const CSS_PIXELS_PER_INCH: f64 = 96.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImageLayout {
    Pages,
    Long,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageExportRequest {
    pub path: String,
    pub html: String,
    pub format: ImageFormat,
    pub layout: ImageLayout,
    pub scale: u8,
    pub quality: u8,
    pub paper_width_mm: f64,
    pub paper_height_mm: f64,
    pub background_color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageExportResult {
    pub paths: Vec<String>,
    pub width: u32,
    pub height: u32,
    pub page_count: usize,
}

impl ImageFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Webp => "webp",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Png => "PNG",
            Self::Jpeg => "JPEG",
            Self::Webp => "WebP",
        }
    }
}

fn validate_dimensions(
    format: ImageFormat,
    width: u32,
    height: u32,
    layout: ImageLayout,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Image dimensions must be positive".to_string());
    }
    let axis_limit = match format {
        ImageFormat::Webp => Some(MAX_WEBP_AXIS),
        ImageFormat::Jpeg => Some(MAX_JPEG_AXIS),
        ImageFormat::Png => None,
    };
    if let Some(limit) = axis_limit
        && (width > limit || height > limit)
    {
        return Err(format!(
            "{} images cannot exceed {limit} pixels on either side. Lower the scale or use Pages.",
            format.label()
        ));
    }
    if layout == ImageLayout::Long && u64::from(width) * u64::from(height) > MAX_LONG_IMAGE_PIXELS {
        return Err(
            "Long images cannot exceed 100,000,000 pixels. Lower the scale or use Pages."
                .to_string(),
        );
    }
    Ok(())
}

fn paper_viewport_points(width_mm: f64, height_mm: f64) -> Result<(f64, f64), String> {
    if !width_mm.is_finite() || !height_mm.is_finite() {
        return Err("Image paper dimensions must be finite".to_string());
    }
    if !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&width_mm)
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&height_mm)
    {
        return Err(format!(
            "Image paper dimensions must be between {MIN_PAPER_MM} and {MAX_PAPER_MM} mm"
        ));
    }
    Ok((width_mm * 72.0 / 25.4, height_mm * 72.0 / 25.4))
}

fn page_pixel_size(width_mm: f64, height_mm: f64, scale: u8) -> Result<(u32, u32), String> {
    if !(1..=3).contains(&scale) {
        return Err("Image scale must be 1, 2, or 3".to_string());
    }
    paper_viewport_points(width_mm, height_mm)?;
    let scale = f64::from(scale);
    let width = (width_mm / 25.4 * CSS_PIXELS_PER_INCH * scale).round();
    let height = (height_mm / 25.4 * CSS_PIXELS_PER_INCH * scale).round();
    if width > f64::from(u32::MAX) || height > f64::from(u32::MAX) {
        return Err("Image dimensions exceed the platform limit".to_string());
    }
    Ok((width as u32, height as u32))
}

fn parse_background_color(value: &str) -> Result<[u8; 3], String> {
    let hex = value
        .strip_prefix('#')
        .ok_or_else(|| "Image background color must use #RRGGBB".to_string())?;
    if hex.len() != 6 {
        return Err("Image background color must use #RRGGBB".to_string());
    }
    let channel = |start| {
        u8::from_str_radix(&hex[start..start + 2], 16)
            .map_err(|_| "Image background color must use #RRGGBB".to_string())
    };
    Ok([channel(0)?, channel(2)?, channel(4)?])
}

fn composite_background(rgba: &mut [u8], background: [u8; 3]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = u16::from(pixel[3]);
        for channel in 0..3 {
            pixel[channel] = ((u16::from(pixel[channel]) * alpha
                + u16::from(background[channel]) * (255 - alpha)
                + 127)
                / 255) as u8;
        }
        pixel[3] = 255;
    }
}

fn tile_copy_window(tile_start: u32, total_height: u32, viewport_height: u32) -> (u32, u32, u32) {
    let scroll_top = tile_start.min(total_height.saturating_sub(viewport_height));
    let source_y = tile_start - scroll_top;
    let copy_height = (viewport_height - source_y).min(total_height - tile_start);
    (scroll_top, source_y, copy_height)
}

fn validate_rgba_buffer(width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let expected = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| "Image dimensions exceed the platform buffer limit".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "RGBA buffer length mismatch: expected {expected} bytes, received {}",
            rgba.len()
        ));
    }
    Ok(())
}

fn encode_rgba(
    format: ImageFormat,
    quality: u8,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<Vec<u8>, String> {
    validate_dimensions(format, width, height, ImageLayout::Pages)?;
    validate_rgba_buffer(width, height, rgba)?;
    if !(1..=100).contains(&quality) {
        return Err("Image quality must be between 1 and 100".to_string());
    }

    match format {
        ImageFormat::Png => {
            let mut encoded = Cursor::new(Vec::new());
            PngEncoder::new(&mut encoded)
                .write_image(rgba, width, height, ExtendedColorType::Rgba8)
                .map_err(|error| format!("Could not encode PNG: {error}"))?;
            Ok(encoded.into_inner())
        }
        ImageFormat::Jpeg => {
            let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
            for pixel in rgba.chunks_exact(4) {
                rgb.extend_from_slice(&pixel[..3]);
            }
            let mut encoded = Cursor::new(Vec::new());
            JpegEncoder::new_with_quality(&mut encoded, quality)
                .write_image(&rgb, width, height, ExtendedColorType::Rgb8)
                .map_err(|error| format!("Could not encode JPEG: {error}"))?;
            Ok(encoded.into_inner())
        }
        ImageFormat::Webp => EncoderConfig::new()
            .quality(f32::from(quality))
            .encode_rgba(rgba, width, height, Unstoppable)
            .map_err(|error| format!("Could not encode WebP: {error}")),
    }
}

fn page_output_paths(
    selected_path: &Path,
    format: ImageFormat,
    page_count: usize,
) -> Result<Vec<PathBuf>, String> {
    if !(1..=MAX_PAGES).contains(&page_count) {
        return Err(format!("Image export supports 1 to {MAX_PAGES} pages"));
    }
    let stem = selected_path
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .ok_or_else(|| "Choose an image file name".to_string())?;
    let parent = selected_path.parent().unwrap_or_else(|| Path::new(""));

    Ok((1..=page_count)
        .map(|index| {
            let mut name = OsString::from(stem);
            name.push(format!("-{index:03}.{}", format.extension()));
            parent.join(name)
        })
        .collect())
}

fn ensure_parent_dir(path: &Path) -> Result<&Path, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    if !parent.as_os_str().is_empty() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create image export directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    Ok(if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    })
}

fn rollback_outputs(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = std::fs::remove_file(path);
    }
}

fn write_page_outputs_with_hook<F>(
    targets: &[PathBuf],
    encoded_pages: &[Vec<u8>],
    mut before_persist: F,
) -> Result<(), String>
where
    F: FnMut(usize, &Path) -> Result<(), String>,
{
    if targets.len() != encoded_pages.len() || targets.is_empty() {
        return Err("Image page targets do not match encoded pages".to_string());
    }
    for target in targets {
        if target.try_exists().map_err(|error| {
            format!(
                "Could not inspect image output '{}': {error}",
                target.display()
            )
        })? {
            return Err(format!(
                "Image output '{}' already exists. Choose another name or remove the existing file.",
                target.display()
            ));
        }
    }

    let mut staged = Vec::with_capacity(targets.len());
    for (target, contents) in targets.iter().zip(encoded_pages) {
        let parent = ensure_parent_dir(target)?;
        let mut file = NamedTempFile::new_in(parent).map_err(|error| {
            format!(
                "Could not create a temporary image beside '{}': {error}",
                target.display()
            )
        })?;
        file.write_all(contents).map_err(|error| {
            format!(
                "Could not write a temporary image for '{}': {error}",
                target.display()
            )
        })?;
        file.as_file().sync_all().map_err(|error| {
            format!(
                "Could not flush a temporary image for '{}': {error}",
                target.display()
            )
        })?;
        staged.push(Some(file));
    }

    let mut committed = Vec::with_capacity(targets.len());
    for (index, target) in targets.iter().enumerate() {
        if let Err(error) = before_persist(index, target) {
            rollback_outputs(&committed);
            return Err(error);
        }
        let file = staged[index].take().expect("staged output must exist");
        if let Err(error) = file.persist_noclobber(target) {
            rollback_outputs(&committed);
            return Err(format!(
                "Image output '{}' already exists or changed while exporting: {}",
                target.display(),
                error.error
            ));
        }
        committed.push(target.clone());
    }
    Ok(())
}

fn write_page_outputs(targets: &[PathBuf], encoded_pages: &[Vec<u8>]) -> Result<(), String> {
    write_page_outputs_with_hook(targets, encoded_pages, |_index, _target| Ok(()))
}

fn preflight_page_outputs(targets: &[PathBuf]) -> Result<(), String> {
    for target in targets {
        if target.try_exists().map_err(|error| {
            format!(
                "Could not inspect image output '{}': {error}",
                target.display()
            )
        })? {
            return Err(format!(
                "Image output '{}' already exists. Choose another name or remove the existing file.",
                target.display()
            ));
        }
    }
    Ok(())
}

fn write_replacing_output(target: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = ensure_parent_dir(target)?;
    let mut file = NamedTempFile::new_in(parent).map_err(|error| {
        format!(
            "Could not create a temporary image beside '{}': {error}",
            target.display()
        )
    })?;
    file.write_all(contents).map_err(|error| {
        format!(
            "Could not write a temporary image for '{}': {error}",
            target.display()
        )
    })?;
    file.as_file().sync_all().map_err(|error| {
        format!(
            "Could not flush a temporary image for '{}': {error}",
            target.display()
        )
    })?;
    file.persist(target).map_err(|error| {
        format!(
            "Could not replace image output '{}': {}",
            target.display(),
            error.error
        )
    })?;
    Ok(())
}

pub(crate) fn write_image_file(request: &ImageExportRequest) -> Result<ImageExportResult, String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_image_file(request)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = request;
        Err("Image export is only supported on macOS".to_string())
    }
}

pub(crate) fn format_image_export_error(path: &str, error: &str) -> String {
    format!("Could not export '{path}' as an image: {error}")
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};

    use super::{
        ImageExportRequest, ImageExportResult, ImageLayout, MAX_PAGES, composite_background,
        encode_rgba, page_output_paths, page_pixel_size, paper_viewport_points,
        parse_background_color, preflight_page_outputs, tile_copy_window, validate_dimensions,
        write_page_outputs, write_replacing_output,
    };
    use crate::web_export::macos::WebExportSession;

    const PAGINATION_PROBE_JS: &str = r#"(function () {
  if (window.__markdownerPdfPaginationStatus === "error") return -1;
  var result = window.__markdownerPdfPaginationResult;
  return result && Number.isFinite(result.totalHeight) ? result.totalHeight : 0;
})()"#;
    const CONTINUOUS_HEIGHT_PROBE_JS: &str = r#"(function () {
  var element = document.querySelector('.markdowner-export');
  if (!element) return -1;
  var rect = element.getBoundingClientRect();
  var height = Math.max(rect.height, element.scrollHeight);
  return Number.isFinite(height) && height > 0 ? height : -1;
})()"#;

    fn pagination_probe_result(value: f64) -> Option<Result<f64, String>> {
        if value == 0.0 {
            return None;
        }
        if value == -1.0 {
            return Some(Err(
                "The embedded image pagination script reported an error".to_string(),
            ));
        }
        if !value.is_finite() || value < 0.0 {
            return Some(Err(
                "The embedded image pagination script returned an invalid height".to_string(),
            ));
        }
        Some(Ok(value))
    }

    fn wait_for_continuous_height(session: &WebExportSession) -> Result<f64, String> {
        let mut previous = None;
        let mut stable_count = 0;
        session.wait_for_number(
            CONTINUOUS_HEIGHT_PROBE_JS,
            "Timed out waiting for continuous image layout",
            move |value| {
                if !value.is_finite() || value <= 0.0 {
                    return Some(Err(
                        "Could not measure the continuous image layout".to_string()
                    ));
                }
                if previous.is_some_and(|last: f64| (last - value).abs() < 0.5) {
                    stable_count += 1;
                } else {
                    previous = Some(value);
                    stable_count = 0;
                }
                (stable_count >= 1).then_some(Ok(value))
            },
        )
    }

    fn allocate_rgba(width: u32, height: u32) -> Result<Vec<u8>, String> {
        let length = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .and_then(|bytes| usize::try_from(bytes).ok())
            .ok_or_else(|| "Image dimensions exceed the platform buffer limit".to_string())?;
        let mut buffer = Vec::new();
        buffer
            .try_reserve_exact(length)
            .map_err(|_| "Could not allocate the long image buffer".to_string())?;
        buffer.resize(length, 0);
        Ok(buffer)
    }

    fn capture_pages(
        request: &ImageExportRequest,
        paper_width: f64,
        paper_height: f64,
        output_width: u32,
        output_height: u32,
        background: [u8; 3],
    ) -> Result<ImageExportResult, String> {
        validate_dimensions(
            request.format,
            output_width,
            output_height,
            ImageLayout::Pages,
        )?;
        let session = WebExportSession::load(&request.html, paper_width, paper_height)?;
        let total_height = session
            .wait_for_number(
                PAGINATION_PROBE_JS,
                "Timed out waiting for embedded image pagination",
                pagination_probe_result,
            )?
            .max(paper_height);
        let page_count = ((total_height / paper_height).ceil() as usize).max(1);
        if page_count > MAX_PAGES {
            return Err(format!("Image export exceeds the {MAX_PAGES} pages limit"));
        }
        let targets = page_output_paths(Path::new(&request.path), request.format, page_count)?;
        preflight_page_outputs(&targets)?;

        // Pad the scroll area to a complete final page. Without this, WebKit
        // clamps the last offset and the bottom of the previous page repeats.
        let padded_height = page_count as f64 * paper_height;
        session.eval_number(&format!(
            "document.documentElement.style.minHeight='{padded_height}px'; document.body.style.minHeight='{padded_height}px'; document.documentElement.scrollHeight"
        ))?;

        let mut encoded_pages = Vec::with_capacity(page_count);
        for index in 0..page_count {
            let target_y = index as f64 * paper_height;
            let actual_y = session.scroll_to(target_y)?;
            if (actual_y - target_y).abs() > 1.0 {
                return Err(format!(
                    "WebKit could not position image page {} for capture",
                    index + 1
                ));
            }
            let mut rgba = session.snapshot_rgba(output_width, output_height)?;
            composite_background(&mut rgba, background);
            encoded_pages.push(encode_rgba(
                request.format,
                request.quality,
                output_width,
                output_height,
                &rgba,
            )?);
        }
        write_page_outputs(&targets, &encoded_pages)?;

        Ok(ImageExportResult {
            paths: display_paths(&targets),
            width: output_width,
            height: output_height,
            page_count,
        })
    }

    fn capture_long(
        request: &ImageExportRequest,
        paper_width: f64,
        paper_height: f64,
        output_width: u32,
        viewport_output_height: u32,
        background: [u8; 3],
    ) -> Result<ImageExportResult, String> {
        let session = WebExportSession::load(&request.html, paper_width, paper_height)?;
        let content_height = wait_for_continuous_height(&session)?;
        let output_height = (content_height / paper_width * f64::from(output_width)).round();
        if !(1.0..=f64::from(u32::MAX)).contains(&output_height) {
            return Err("Continuous image height exceeds the platform limit".to_string());
        }
        let output_height = output_height as u32;
        validate_dimensions(
            request.format,
            output_width,
            output_height,
            ImageLayout::Long,
        )?;
        let mut result = allocate_rgba(output_width, output_height)?;
        let row_bytes = usize::try_from(u64::from(output_width) * 4)
            .map_err(|_| "Image row width exceeds the platform limit".to_string())?;
        let css_per_output_pixel = paper_width / f64::from(output_width);

        let mut tile_start = 0;
        while tile_start < output_height {
            let (scroll_top, source_y, copy_height) =
                tile_copy_window(tile_start, output_height, viewport_output_height);
            let requested_css_y = f64::from(scroll_top) * css_per_output_pixel;
            let actual_css_y = session.scroll_to(requested_css_y)?;
            if (actual_css_y - requested_css_y).abs() > 1.0 {
                return Err("WebKit could not position a long-image tile for capture".to_string());
            }
            let tile = session.snapshot_rgba(output_width, viewport_output_height)?;
            for row in 0..copy_height {
                let source_row = usize::try_from(source_y + row)
                    .map_err(|_| "Image tile offset exceeds the platform limit".to_string())?;
                let target_row = usize::try_from(tile_start + row)
                    .map_err(|_| "Image output offset exceeds the platform limit".to_string())?;
                let source_start = source_row * row_bytes;
                let target_start = target_row * row_bytes;
                result[target_start..target_start + row_bytes]
                    .copy_from_slice(&tile[source_start..source_start + row_bytes]);
            }
            tile_start += copy_height;
        }

        composite_background(&mut result, background);
        let encoded = encode_rgba(
            request.format,
            request.quality,
            output_width,
            output_height,
            &result,
        )?;
        let target = Path::new(&request.path);
        write_replacing_output(target, &encoded)?;

        Ok(ImageExportResult {
            paths: vec![target.to_string_lossy().into_owned()],
            width: output_width,
            height: output_height,
            page_count: 1,
        })
    }

    fn display_paths(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }

    pub(super) fn write_image_file(
        request: &ImageExportRequest,
    ) -> Result<ImageExportResult, String> {
        if request.path.trim().is_empty() {
            return Err("Choose an image export path".to_string());
        }
        if request.html.trim().is_empty() {
            return Err("Image export HTML cannot be empty".to_string());
        }
        if !(1..=100).contains(&request.quality) {
            return Err("Image quality must be between 1 and 100".to_string());
        }
        let background = parse_background_color(&request.background_color)?;
        let (paper_width, paper_height) =
            paper_viewport_points(request.paper_width_mm, request.paper_height_mm)?;
        let (output_width, output_height) = page_pixel_size(
            request.paper_width_mm,
            request.paper_height_mm,
            request.scale,
        )?;

        match request.layout {
            ImageLayout::Pages => capture_pages(
                request,
                paper_width,
                paper_height,
                output_width,
                output_height,
                background,
            ),
            ImageLayout::Long => capture_long(
                request,
                paper_width,
                paper_height,
                output_width,
                output_height,
                background,
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::{
        ImageFormat, ImageLayout, composite_background, encode_rgba, page_output_paths,
        page_pixel_size, tile_copy_window, validate_dimensions, write_page_outputs_with_hook,
    };

    #[test]
    fn image_export_builds_three_digit_page_paths() {
        assert_eq!(
            page_output_paths(Path::new("/tmp/Guide.webp"), ImageFormat::Webp, 2)
                .expect("valid paths"),
            vec![
                Path::new("/tmp/Guide-001.webp").to_path_buf(),
                Path::new("/tmp/Guide-002.webp").to_path_buf(),
            ]
        );
        assert_eq!(
            page_output_paths(Path::new("/tmp/Guide.jpg"), ImageFormat::Png, 1)
                .expect("valid path"),
            vec![Path::new("/tmp/Guide-001.png").to_path_buf()]
        );
    }

    #[test]
    fn image_export_rejects_codec_and_long_image_limits() {
        assert!(validate_dimensions(ImageFormat::Webp, 16_384, 200, ImageLayout::Long).is_err());
        assert!(validate_dimensions(ImageFormat::Jpeg, 200, 65_536, ImageLayout::Long).is_err());
        assert!(validate_dimensions(ImageFormat::Png, 10_001, 10_000, ImageLayout::Long).is_err());
        assert!(validate_dimensions(ImageFormat::Webp, 2_000, 10_000, ImageLayout::Long).is_ok());
    }

    #[test]
    fn image_export_encodes_all_supported_formats() {
        let pixel = [255, 0, 0, 255];
        let png = encode_rgba(ImageFormat::Png, 90, 1, 1, &pixel).expect("PNG");
        let jpeg = encode_rgba(ImageFormat::Jpeg, 90, 1, 1, &pixel).expect("JPEG");
        let webp = encode_rgba(ImageFormat::Webp, 90, 1, 1, &pixel).expect("WebP");

        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(jpeg.starts_with(&[0xff, 0xd8, 0xff]));
        assert!(webp.starts_with(b"RIFF"));
        assert_eq!(&webp[8..12], b"WEBP");
    }

    #[test]
    fn image_export_rolls_back_committed_pages_after_a_late_collision() {
        let root = tempdir().expect("temp directory");
        let marker = root.path().join("existing.txt");
        fs::write(&marker, "keep").expect("marker");
        let targets = vec![
            root.path().join("Guide-001.png"),
            root.path().join("Guide-002.png"),
        ];
        let late_collision = targets[1].clone();

        let error = write_page_outputs_with_hook(
            &targets,
            &[b"first".to_vec(), b"second".to_vec()],
            move |index, _target| {
                if index == 1 {
                    fs::write(&late_collision, "do not replace")
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            },
        )
        .expect_err("second target must collide");

        assert!(error.contains("already exists"));
        assert!(!targets[0].exists());
        assert_eq!(
            fs::read_to_string(&targets[1]).expect("collision"),
            "do not replace"
        );
        assert_eq!(fs::read_to_string(marker).expect("marker"), "keep");
        assert_eq!(
            fs::read_dir(root.path()).expect("directory").count(),
            2,
            "temporary files must be removed"
        );
    }

    #[test]
    fn image_export_uses_css_pixel_geometry_and_opaque_backgrounds() {
        assert_eq!(page_pixel_size(25.4, 50.8, 2).expect("size"), (192, 384));
        let mut pixels = vec![255, 0, 0, 128, 0, 0, 0, 0];
        composite_background(&mut pixels, [0, 0, 255]);
        assert_eq!(pixels, vec![128, 0, 127, 255, 0, 0, 255, 255]);
    }

    #[test]
    fn long_image_final_tile_copies_only_the_unwritten_tail() {
        assert_eq!(tile_copy_window(0, 2_500, 1_000), (0, 0, 1_000));
        assert_eq!(tile_copy_window(1_000, 2_500, 1_000), (1_000, 0, 1_000));
        assert_eq!(tile_copy_window(2_000, 2_500, 1_000), (1_500, 500, 500));
        assert_eq!(tile_copy_window(0, 600, 1_000), (0, 0, 600));
    }
}
