use std::path::Path;

pub fn write_pdf_file(path: &str, html: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_pdf_file(path, html)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, html);
        Err("PDF export is only supported on macOS".to_string())
    }
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Could not create export directory '{}': {error}",
                    parent.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::{
        path::Path,
        sync::mpsc,
        time::{Duration, Instant},
    };

    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_core_foundation::{kCFRunLoopDefaultMode, CFRunLoop, CGPoint, CGRect, CGSize};
    use objc2_foundation::{MainThreadMarker, NSData, NSError, NSNumber, NSString};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration};

    use super::ensure_parent_dir;

    const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
    const JS_TIMEOUT: Duration = Duration::from_secs(10);
    const PDF_TIMEOUT: Duration = Duration::from_secs(20);
    const PDF_WIDTH: f64 = 820.0;
    const PDF_MIN_HEIGHT: f64 = 1160.0;

    fn tick_run_loop() {
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, 0.05, true);
    }

    fn wait_for_load(webview: &WKWebView) -> Result<(), String> {
        let deadline = Instant::now() + LOAD_TIMEOUT;
        while unsafe { webview.isLoading() } {
            if Instant::now() >= deadline {
                return Err("Timed out loading export HTML for PDF generation".to_string());
            }
            tick_run_loop();
        }
        // Give WebKit one extra pass to finish layout after the load flag clears.
        tick_run_loop();
        Ok(())
    }

    fn wait_for_pdf(receiver: mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
        let deadline = Instant::now() + PDF_TIMEOUT;
        loop {
            match receiver.try_recv() {
                Ok(result) => return result,
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("PDF generation finished without returning data".to_string());
                }
                Err(mpsc::TryRecvError::Empty) => {
                    if Instant::now() >= deadline {
                        return Err("Timed out waiting for WebKit to create the PDF".to_string());
                    }
                    tick_run_loop();
                }
            }
        }
    }

    fn wait_for_js_number(receiver: mpsc::Receiver<Result<f64, String>>) -> Result<f64, String> {
        let deadline = Instant::now() + JS_TIMEOUT;
        loop {
            match receiver.try_recv() {
                Ok(result) => return result,
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Err("JavaScript evaluation finished without returning data".to_string());
                }
                Err(mpsc::TryRecvError::Empty) => {
                    if Instant::now() >= deadline {
                        return Err("Timed out measuring the export document height".to_string());
                    }
                    tick_run_loop();
                }
            }
        }
    }

    fn document_height(webview: &WKWebView) -> Result<f64, String> {
        let (sender, receiver) = mpsc::channel::<Result<f64, String>>();
        let script = NSString::from_str(
            "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, \
             document.body.offsetHeight, document.documentElement.offsetHeight)",
        );
        let completion = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = if error.is_null() {
                if value.is_null() {
                    Err("WebKit did not return a document height".to_string())
                } else {
                    let number = unsafe { &*(value.cast::<NSNumber>()) };
                    Ok(number.doubleValue())
                }
            } else {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!(
                    "Could not measure the export document height: {message}"
                ))
            };
            let _ = sender.send(result);
        });
        unsafe {
            webview.evaluateJavaScript_completionHandler(&script, Some(&completion));
        }
        wait_for_js_number(receiver)
    }

    pub fn write_pdf_file(path: &str, html: &str) -> Result<(), String> {
        let output_path = Path::new(path);
        ensure_parent_dir(output_path)?;

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "PDF export must run on the macOS main thread".to_string())?;
        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        let frame = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: PDF_WIDTH,
                height: PDF_MIN_HEIGHT,
            },
        };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(mtm.alloc::<WKWebView>(), frame, &configuration)
        };
        let html = NSString::from_str(html);
        unsafe {
            webview.loadHTMLString_baseURL(&html, None);
        }
        wait_for_load(&webview)?;
        let height = document_height(&webview)?.max(PDF_MIN_HEIGHT).ceil();

        let (sender, receiver) = mpsc::channel::<Result<(), String>>();
        let output = path.to_string();
        let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if error.is_null() {
                if data.is_null() {
                    Err("WebKit did not return PDF data".to_string())
                } else {
                    let output = NSString::from_str(&output);
                    let written = unsafe { (*data).writeToFile_atomically(&output, true) };
                    if written {
                        Ok(())
                    } else {
                        Err("WebKit could not write the PDF file".to_string())
                    }
                }
            } else {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!("WebKit could not create the PDF: {message}"))
            };
            let _ = sender.send(result);
        });
        let pdf_config = unsafe { WKPDFConfiguration::new(mtm) };
        unsafe {
            pdf_config.setRect(CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize {
                    width: PDF_WIDTH,
                    height,
                },
            });
        }
        unsafe {
            webview.createPDFWithConfiguration_completionHandler(Some(&pdf_config), &completion);
        }
        wait_for_pdf(receiver)
    }
}
