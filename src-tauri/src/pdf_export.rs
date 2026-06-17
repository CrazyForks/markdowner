use std::path::Path;

pub fn write_pdf_file(path: &str, html: &str, paper_size: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_pdf_file(path, html, paper_size)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, html, paper_size);
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
        cell::RefCell,
        path::Path,
        rc::Rc,
        time::{Duration, Instant},
    };

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_core_foundation::{kCFRunLoopDefaultMode, CFRunLoop, CGPoint, CGRect, CGSize};
    use objc2_foundation::{MainThreadMarker, NSData, NSError, NSNumber, NSString};
    use objc2_pdf_kit::PDFDocument;
    use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration};

    use super::ensure_parent_dir;

    const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
    const JS_TIMEOUT: Duration = Duration::from_secs(10);
    const PDF_TIMEOUT: Duration = Duration::from_secs(20);
    /// 10 mm in PostScript points (and CSS px — WebKit maps 1 px → 1 pt for
    /// `createPDF`, so the same number works as a page margin in both spaces).
    const PAGE_MARGIN: f64 = 10.0 / 25.4 * 72.0;
    const INITIAL_HEIGHT: f64 = 1160.0;
    /// Hard ceiling on generated pages — a deterministic backstop, never reached
    /// by a real document, that bounds the work even for pathological input.
    const MAX_PAGES: usize = 1000;

    /// Pushes block elements that would straddle a page boundary down to the next
    /// page (leaving a top margin), so fixed-height A4 slices break cleanly between
    /// blocks instead of cutting through text. Returns the paginated document
    /// height. Blocks taller than a usable page are left in place (and may split).
    const PAGINATE_JS: &str = r#"(function(){
  var PAGE=__PAGE__, M=__MARGIN__;
  var c=document.querySelector('.markdowner-export')||document.body;
  c.style.boxSizing='border-box';
  c.style.margin='0';
  c.style.padding=M+'px '+M+'px 0 '+M+'px';
  var kids=Array.prototype.slice.call(c.children);
  for(var i=0;i<kids.length;i++){
    var el=kids[i];
    if(!el.getBoundingClientRect) continue;
    var r=el.getBoundingClientRect();
    var top=r.top+window.scrollY, h=r.height;
    if(h<=0||h>PAGE-2*M) continue;
    var pageStart=Math.floor(top/PAGE)*PAGE;
    if(top+h>pageStart+PAGE-M){
      var target=pageStart+PAGE+M;
      var cur=parseFloat(window.getComputedStyle(el).marginTop)||0;
      el.style.marginTop=(cur+(target-top))+'px';
    }
  }
  return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
})()"#;

    /// Paper dimensions in points: (width, height).
    fn paper_points(paper_size: &str) -> (f64, f64) {
        match paper_size {
            "Letter" => (612.0, 792.0),
            // A4: 210 mm × 297 mm.
            _ => (210.0 / 25.4 * 72.0, 297.0 / 25.4 * 72.0),
        }
    }

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
        // Extra passes so layout settles and embedded image data URIs decode.
        tick_run_loop();
        tick_run_loop();
        Ok(())
    }

    /// Evaluate JS that returns a number, pumping the run loop until it resolves.
    fn eval_js_number(webview: &WKWebView, script: &str) -> Result<f64, String> {
        let slot: Rc<RefCell<Option<Result<f64, String>>>> = Rc::new(RefCell::new(None));
        let sink = slot.clone();
        let completion = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = if !error.is_null() {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!("JavaScript evaluation failed: {message}"))
            } else if value.is_null() {
                Err("JavaScript evaluation returned no value".to_string())
            } else {
                let number = unsafe { &*(value.cast::<NSNumber>()) };
                Ok(number.doubleValue())
            };
            *sink.borrow_mut() = Some(result);
        });
        let script = NSString::from_str(script);
        unsafe {
            webview.evaluateJavaScript_completionHandler(&script, Some(&completion));
        }
        let deadline = Instant::now() + JS_TIMEOUT;
        loop {
            if slot.borrow().is_some() {
                return slot.borrow_mut().take().unwrap();
            }
            if Instant::now() >= deadline {
                return Err("Timed out running the pagination script".to_string());
            }
            tick_run_loop();
        }
    }

    /// Render one page-sized region of the web view to standalone PDF data.
    fn create_pdf_page(
        mtm: MainThreadMarker,
        webview: &WKWebView,
        rect: CGRect,
    ) -> Result<Retained<NSData>, String> {
        let slot: Rc<RefCell<Option<Result<Retained<NSData>, String>>>> =
            Rc::new(RefCell::new(None));
        let sink = slot.clone();
        let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if !error.is_null() {
                let message = unsafe { (*error).localizedDescription() }.to_string();
                Err(format!("WebKit could not create the PDF: {message}"))
            } else {
                match unsafe { Retained::retain(data) } {
                    Some(data) => Ok(data),
                    None => Err("WebKit did not return PDF data".to_string()),
                }
            };
            *sink.borrow_mut() = Some(result);
        });

        let config = unsafe { WKPDFConfiguration::new(mtm) };
        unsafe {
            config.setRect(rect);
            webview.createPDFWithConfiguration_completionHandler(Some(&config), &completion);
        }

        let deadline = Instant::now() + PDF_TIMEOUT;
        loop {
            if slot.borrow().is_some() {
                return slot.borrow_mut().take().unwrap();
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for WebKit to create the PDF".to_string());
            }
            tick_run_loop();
        }
    }

    pub fn write_pdf_file(path: &str, html: &str, paper_size: &str) -> Result<(), String> {
        let output_path = Path::new(path);
        ensure_parent_dir(output_path)?;

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "PDF export must run on the macOS main thread".to_string())?;

        let (paper_width, paper_height) = paper_points(paper_size);

        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        let frame = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: paper_width,
                height: INITIAL_HEIGHT,
            },
        };
        let webview = unsafe {
            WKWebView::initWithFrame_configuration(mtm.alloc::<WKWebView>(), frame, &configuration)
        };
        let html_string = NSString::from_str(html);
        unsafe {
            webview.loadHTMLString_baseURL(&html_string, None);
        }
        wait_for_load(&webview)?;

        // Align block boundaries to page edges, then measure the paginated height.
        let script = PAGINATE_JS
            .replace("__PAGE__", &paper_height.to_string())
            .replace("__MARGIN__", &PAGE_MARGIN.to_string());
        let total_height = eval_js_number(&webview, &script)?.max(paper_height);
        let page_count = ((total_height / paper_height).ceil() as usize).clamp(1, MAX_PAGES);
        tick_run_loop();

        // Each page is a fixed A4/Letter slice; merge them into one document.
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
            let data = create_pdf_page(mtm, &webview, rect)?;
            let page_doc = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
                .ok_or_else(|| "Could not read a generated PDF page".to_string())?;
            if let Some(page) = unsafe { page_doc.pageAtIndex(0) } {
                let at = unsafe { combined.pageCount() };
                unsafe { combined.insertPage_atIndex(&page, at) };
            }
        }

        let written = unsafe { combined.writeToFile(&NSString::from_str(path)) };
        if written {
            Ok(())
        } else {
            Err("WebKit could not write the PDF file".to_string())
        }
    }
}
