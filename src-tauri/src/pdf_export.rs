use std::path::Path;

pub fn write_pdf_file(
    path: &str,
    html: &str,
    paper_width_mm: f64,
    paper_height_mm: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_pdf_file(path, html, paper_width_mm, paper_height_mm)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, html, paper_width_mm, paper_height_mm);
        Err("PDF export is only supported on macOS".to_string())
    }
}

const MIN_PAPER_MM: f64 = 25.4;
const MAX_PAPER_MM: f64 = 2000.0;
const MAX_PAGES: usize = 100;

fn paper_points(width_mm: f64, height_mm: f64) -> Result<(f64, f64), String> {
    if !width_mm.is_finite() || !height_mm.is_finite() {
        return Err("PDF paper dimensions must be finite".to_string());
    }
    if !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&width_mm)
        || !(MIN_PAPER_MM..=MAX_PAPER_MM).contains(&height_mm)
    {
        return Err(format!(
            "PDF paper dimensions must be between {MIN_PAPER_MM} and {MAX_PAPER_MM} mm"
        ));
    }
    Ok((width_mm * 72.0 / 25.4, height_mm * 72.0 / 25.4))
}

fn pagination_probe_result(value: f64) -> Option<Result<f64, String>> {
    if value == 0.0 {
        return None;
    }
    if value == -1.0 {
        return Some(Err(
            "The embedded PDF pagination script reported an error".to_string()
        ));
    }
    if !value.is_finite() || value < 0.0 {
        return Some(Err(
            "The embedded PDF pagination script returned an invalid height".to_string(),
        ));
    }
    Some(Ok(value))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create export directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    Ok(())
}

pub fn format_pdf_export_error(path: &str, error: &str) -> String {
    format!("Could not export '{path}' to PDF: {error}")
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::Path;

    use objc2::AnyThread;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::NSString;
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};

    use super::{MAX_PAGES, ensure_parent_dir, pagination_probe_result, paper_points};
    use crate::web_export::macos::WebExportSession;

    const PAGINATION_PROBE_JS: &str = r#"(function () {
  if (window.__markdownerPdfPaginationStatus === "error") return -1;
  var result = window.__markdownerPdfPaginationResult;
  return result && Number.isFinite(result.totalHeight) ? result.totalHeight : 0;
})()"#;

    pub(super) fn pdf_page_media_box(paper_width: f64, paper_height: f64) -> CGRect {
        CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: paper_width,
                height: paper_height,
            },
        }
    }

    pub fn write_pdf_file(
        path: &str,
        html: &str,
        paper_width_mm: f64,
        paper_height_mm: f64,
    ) -> Result<(), String> {
        let output_path = Path::new(path);
        ensure_parent_dir(output_path)?;
        let (paper_width, paper_height) = paper_points(paper_width_mm, paper_height_mm)?;
        let session = WebExportSession::load(html, paper_width, paper_height)?;
        let total_height = session
            .wait_for_number(
                PAGINATION_PROBE_JS,
                "Timed out waiting for embedded PDF pagination",
                pagination_probe_result,
            )?
            .max(paper_height);
        let page_count = ((total_height / paper_height).ceil() as usize).max(1);
        if page_count > MAX_PAGES {
            return Err(format!("PDF export exceeds the {MAX_PAGES} pages limit"));
        }

        // Each page is a fixed physical-paper slice; merge them into one document.
        let combined = unsafe { PDFDocument::new() };
        for index in 0..page_count {
            let rect = CGRect {
                origin: CGPoint {
                    x: 0.0,
                    y: index as f64 * paper_height,
                },
                size: CGSize {
                    width: paper_width,
                    height: paper_height,
                },
            };
            let data = session.create_pdf(rect)?;
            let page_doc = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
                .ok_or_else(|| "Could not read a generated PDF page".to_string())?;
            if let Some(page) = unsafe { page_doc.pageAtIndex(0) } {
                let media_box = pdf_page_media_box(paper_width, paper_height);
                let at = unsafe { combined.pageCount() };
                unsafe {
                    // WebKit rounds its generated MediaBox down to whole points.
                    // Restore the requested physical dimensions before combining
                    // pages so presets and decimal custom sizes remain exact.
                    page.setBounds_forBox(media_box, PDFDisplayBox::MediaBox);
                    page.setBounds_forBox(media_box, PDFDisplayBox::CropBox);
                    combined.insertPage_atIndex(&page, at);
                }
            }
        }

        if unsafe { combined.writeToFile(&NSString::from_str(path)) } {
            Ok(())
        } else {
            Err("WebKit could not write the PDF file".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::macos::pdf_page_media_box;
    use super::{format_pdf_export_error, pagination_probe_result, paper_points};

    #[test]
    fn export_errors_identify_the_failed_output_path() {
        assert_eq!(
            format_pdf_export_error("/tmp/project/exports/README.pdf", "WebKit timed out"),
            "Could not export '/tmp/project/exports/README.pdf' to PDF: WebKit timed out"
        );
    }

    #[test]
    fn converts_valid_custom_millimetres_to_points() {
        let (width, height) = paper_points(25.4, 50.8).expect("valid dimensions");
        assert!((width - 72.0).abs() < 1e-9);
        assert!((height - 144.0).abs() < 1e-9);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn generated_page_media_box_preserves_fractional_paper_points() {
        let bounds = pdf_page_media_box(595.275_590_551, 841.889_763_78);
        assert!((bounds.size.width - 595.275_590_551).abs() < 1e-9);
        assert!((bounds.size.height - 841.889_763_78).abs() < 1e-9);
    }

    #[test]
    fn rejects_invalid_custom_dimensions() {
        assert!(paper_points(f64::NAN, 297.0).is_err());
        assert!(paper_points(10.0, 297.0).is_err());
        assert!(paper_points(210.0, 2500.0).is_err());
    }

    #[test]
    fn classifies_embedded_pagination_probe_values() {
        assert_eq!(pagination_probe_result(0.0), None);
        assert!(
            pagination_probe_result(-1.0)
                .expect("error result")
                .is_err()
        );
        assert_eq!(pagination_probe_result(842.0), Some(Ok(842.0)),);
        assert!(
            pagination_probe_result(f64::NAN)
                .expect("invalid result")
                .is_err()
        );
    }
}
