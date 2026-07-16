use std::path::Path;

pub fn write_pdf_file(
    path: &str,
    html: &str,
    paper_size: &str,
    page_margin: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::write_pdf_file(path, html, paper_size, page_margin)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, html, paper_size, page_margin);
        Err("PDF export is only supported on macOS".to_string())
    }
}

fn safe_page_margin(value: f64, paper_width: f64, paper_height: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, paper_width.min(paper_height) / 3.0)
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

#[derive(Debug, PartialEq, Eq)]
enum NavigationLoadState {
    Pending,
    Finished,
    Failed(String),
}

fn navigation_load_result(state: &NavigationLoadState) -> Option<Result<(), String>> {
    match state {
        NavigationLoadState::Pending => None,
        NavigationLoadState::Finished => Some(Ok(())),
        NavigationLoadState::Failed(message) => Some(Err(message.clone())),
    }
}

pub fn format_pdf_export_error(path: &str, error: &str) -> String {
    format!("Could not export '{path}' to PDF: {error}")
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
    use objc2::runtime::{NSObject, ProtocolObject};
    use objc2::{AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send};
    use objc2_core_foundation::{CFRunLoop, CGPoint, CGRect, CGSize, kCFRunLoopDefaultMode};
    use objc2_foundation::{
        MainThreadMarker, NSData, NSError, NSNumber, NSObjectProtocol, NSString,
    };
    use objc2_pdf_kit::PDFDocument;
    use objc2_web_kit::{
        WKNavigation, WKNavigationDelegate, WKPDFConfiguration, WKWebView, WKWebViewConfiguration,
    };

    use super::{NavigationLoadState, ensure_parent_dir, navigation_load_result, safe_page_margin};

    const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
    const JS_TIMEOUT: Duration = Duration::from_secs(10);
    const PDF_TIMEOUT: Duration = Duration::from_secs(20);
    const INITIAL_HEIGHT: f64 = 1160.0;
    /// Hard ceiling on generated pages — a deterministic backstop, never reached
    /// by a real document, that bounds the work even for pathological input.
    const MAX_PAGES: usize = 1000;

    struct ExportNavigationDelegateIvars {
        state: Rc<RefCell<NavigationLoadState>>,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = ExportNavigationDelegateIvars]
        struct ExportNavigationDelegate;

        unsafe impl NSObjectProtocol for ExportNavigationDelegate {}

        unsafe impl WKNavigationDelegate for ExportNavigationDelegate {
            #[unsafe(method(webView:didFinishNavigation:))]
            fn did_finish_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
            ) {
                self.finish(NavigationLoadState::Finished);
            }

            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn did_fail_provisional_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                error: &NSError,
            ) {
                self.finish_with_error(error);
            }

            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn did_fail_navigation(
                &self,
                _webview: &WKWebView,
                _navigation: Option<&WKNavigation>,
                error: &NSError,
            ) {
                self.finish_with_error(error);
            }

            #[unsafe(method(webViewWebContentProcessDidTerminate:))]
            fn web_content_process_did_terminate(&self, _webview: &WKWebView) {
                self.finish(NavigationLoadState::Failed(
                    "WebKit content process terminated while loading export HTML".to_string(),
                ));
            }
        }
    );

    impl ExportNavigationDelegate {
        fn new(state: Rc<RefCell<NavigationLoadState>>, mtm: MainThreadMarker) -> Retained<Self> {
            let delegate = Self::alloc(mtm).set_ivars(ExportNavigationDelegateIvars { state });
            unsafe { msg_send![super(delegate), init] }
        }

        fn finish(&self, result: NavigationLoadState) {
            let mut state = self.ivars().state.borrow_mut();
            if matches!(*state, NavigationLoadState::Pending) {
                *state = result;
            }
        }

        fn finish_with_error(&self, error: &NSError) {
            let message = error.localizedDescription().to_string();
            self.finish(NavigationLoadState::Failed(format!(
                "WebKit could not load export HTML: {message}"
            )));
        }
    }

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

    fn wait_for_load(state: &Rc<RefCell<NavigationLoadState>>) -> Result<(), String> {
        let deadline = Instant::now() + LOAD_TIMEOUT;
        loop {
            let result = navigation_load_result(&state.borrow());
            if let Some(result) = result {
                result?;
                // Extra passes so layout settles and embedded image data URIs decode.
                tick_run_loop();
                tick_run_loop();
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Timed out loading export HTML for PDF generation".to_string());
            }
            tick_run_loop();
        }
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

    pub fn write_pdf_file(
        path: &str,
        html: &str,
        paper_size: &str,
        page_margin: f64,
    ) -> Result<(), String> {
        let output_path = Path::new(path);
        ensure_parent_dir(output_path)?;

        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "PDF export must run on the macOS main thread".to_string())?;

        let (paper_width, paper_height) = paper_points(paper_size);
        let page_margin = safe_page_margin(page_margin, paper_width, paper_height);

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
        let navigation_state = Rc::new(RefCell::new(NavigationLoadState::Pending));
        let navigation_delegate = ExportNavigationDelegate::new(navigation_state.clone(), mtm);
        unsafe {
            webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation_delegate)));
        }
        let html_string = NSString::from_str(html);
        let navigation = unsafe { webview.loadHTMLString_baseURL(&html_string, None) };
        if navigation.is_none() {
            return Err("WebKit refused to start loading export HTML".to_string());
        }
        wait_for_load(&navigation_state)?;

        // Align block boundaries to page edges, then measure the paginated height.
        let script = PAGINATE_JS
            .replace("__PAGE__", &paper_height.to_string())
            .replace("__MARGIN__", &page_margin.to_string());
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

#[cfg(test)]
mod tests {
    use super::{
        NavigationLoadState, format_pdf_export_error, navigation_load_result, safe_page_margin,
    };

    #[test]
    fn navigation_load_only_finishes_from_delegate_completion() {
        assert_eq!(navigation_load_result(&NavigationLoadState::Pending), None);
        assert_eq!(
            navigation_load_result(&NavigationLoadState::Finished),
            Some(Ok(()))
        );
        assert_eq!(
            navigation_load_result(&NavigationLoadState::Failed("WebKit failed".to_string())),
            Some(Err("WebKit failed".to_string()))
        );
    }

    #[test]
    fn export_errors_identify_the_failed_output_path() {
        assert_eq!(
            format_pdf_export_error("/tmp/project/exports/README.pdf", "WebKit timed out"),
            "Could not export '/tmp/project/exports/README.pdf' to PDF: WebKit timed out"
        );
    }

    #[test]
    fn clamps_page_margin_to_a_safe_finite_range() {
        assert_eq!(safe_page_margin(-4.0, 595.0, 842.0), 0.0);
        assert_eq!(safe_page_margin(36.0, 595.0, 842.0), 36.0);
        assert_eq!(safe_page_margin(500.0, 595.0, 842.0), 595.0 / 3.0);
        assert_eq!(safe_page_margin(f64::NAN, 595.0, 842.0), 0.0);
    }
}
