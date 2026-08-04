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

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::{
        cell::RefCell,
        rc::Rc,
        time::{Duration, Instant},
    };

    use block2::RcBlock;
    use image::imageops::FilterType;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
    use objc2::{DefinedClass, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::NSImage;
    use objc2_core_foundation::{CFRunLoop, CGPoint, CGRect, CGSize, kCFRunLoopDefaultMode};
    use objc2_foundation::{
        MainThreadMarker, NSData, NSError, NSNumber, NSObjectProtocol, NSString,
    };
    use objc2_web_kit::{
        WKNavigation, WKNavigationDelegate, WKPDFConfiguration, WKSnapshotConfiguration, WKWebView,
        WKWebViewConfiguration,
    };

    use super::{NavigationLoadState, navigation_load_result};

    const LOAD_TIMEOUT: Duration = Duration::from_secs(10);
    const JS_TIMEOUT: Duration = Duration::from_secs(10);
    const CAPTURE_TIMEOUT: Duration = Duration::from_secs(20);
    type AsyncSlot<T> = Rc<RefCell<Option<Result<T, String>>>>;

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

    fn tick_run_loop() {
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, 0.05, true);
    }

    fn wait_for_load(state: &Rc<RefCell<NavigationLoadState>>) -> Result<(), String> {
        let deadline = Instant::now() + LOAD_TIMEOUT;
        loop {
            if let Some(result) = navigation_load_result(&state.borrow()) {
                result?;
                // Extra passes let layout settle and embedded image data URIs decode.
                tick_run_loop();
                tick_run_loop();
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Timed out loading export HTML".to_string());
            }
            tick_run_loop();
        }
    }

    pub(crate) struct WebExportSession {
        mtm: MainThreadMarker,
        webview: Retained<WKWebView>,
        _navigation_delegate: Retained<ExportNavigationDelegate>,
        viewport_width: f64,
        viewport_height: f64,
    }

    impl WebExportSession {
        pub(crate) fn load(html: &str, width: f64, height: f64) -> Result<Self, String> {
            if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
                return Err(
                    "Web export viewport dimensions must be positive and finite".to_string()
                );
            }
            let mtm = MainThreadMarker::new()
                .ok_or_else(|| "Web export must run on the macOS main thread".to_string())?;
            let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
            let frame = CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize { width, height },
            };
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(
                    mtm.alloc::<WKWebView>(),
                    frame,
                    &configuration,
                )
            };
            let navigation_state = Rc::new(RefCell::new(NavigationLoadState::Pending));
            let navigation_delegate = ExportNavigationDelegate::new(navigation_state.clone(), mtm);
            unsafe {
                webview
                    .setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation_delegate)));
            }
            let navigation =
                unsafe { webview.loadHTMLString_baseURL(&NSString::from_str(html), None) };
            if navigation.is_none() {
                return Err("WebKit refused to start loading export HTML".to_string());
            }
            wait_for_load(&navigation_state)?;

            Ok(Self {
                mtm,
                webview,
                _navigation_delegate: navigation_delegate,
                viewport_width: width,
                viewport_height: height,
            })
        }

        pub(crate) fn eval_number(&self, script: &str) -> Result<f64, String> {
            let slot: AsyncSlot<f64> = Rc::new(RefCell::new(None));
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
            unsafe {
                self.webview.evaluateJavaScript_completionHandler(
                    &NSString::from_str(script),
                    Some(&completion),
                );
            }

            let deadline = Instant::now() + JS_TIMEOUT;
            loop {
                if slot.borrow().is_some() {
                    return slot.borrow_mut().take().unwrap();
                }
                if Instant::now() >= deadline {
                    return Err("Timed out running export JavaScript".to_string());
                }
                tick_run_loop();
            }
        }

        pub(crate) fn wait_for_number<F>(
            &self,
            script: &str,
            timeout_message: &str,
            mut classify: F,
        ) -> Result<f64, String>
        where
            F: FnMut(f64) -> Option<Result<f64, String>>,
        {
            let deadline = Instant::now() + JS_TIMEOUT;
            loop {
                let value = self.eval_number(script)?;
                if let Some(result) = classify(value) {
                    return result;
                }
                if Instant::now() >= deadline {
                    return Err(timeout_message.to_string());
                }
                tick_run_loop();
            }
        }

        pub(crate) fn create_pdf(&self, rect: CGRect) -> Result<Retained<NSData>, String> {
            let slot: AsyncSlot<Retained<NSData>> = Rc::new(RefCell::new(None));
            let sink = slot.clone();
            let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    let message = unsafe { (*error).localizedDescription() }.to_string();
                    Err(format!("WebKit could not create the PDF: {message}"))
                } else {
                    unsafe { Retained::retain(data) }
                        .ok_or_else(|| "WebKit did not return PDF data".to_string())
                };
                *sink.borrow_mut() = Some(result);
            });
            let config = unsafe { WKPDFConfiguration::new(self.mtm) };
            unsafe {
                config.setRect(rect);
                self.webview
                    .createPDFWithConfiguration_completionHandler(Some(&config), &completion);
            }
            wait_for_slot(slot, "Timed out waiting for WebKit to create the PDF")
        }

        pub(crate) fn scroll_to(&self, y: f64) -> Result<f64, String> {
            if !y.is_finite() || y < 0.0 {
                return Err(
                    "Image capture scroll offset must be finite and non-negative".to_string(),
                );
            }
            let actual = self.eval_number(&format!("window.scrollTo(0, {y}); window.scrollY"))?;
            tick_run_loop();
            tick_run_loop();
            Ok(actual)
        }

        pub(crate) fn snapshot_rgba(
            &self,
            expected_width: u32,
            expected_height: u32,
        ) -> Result<Vec<u8>, String> {
            if expected_width == 0 || expected_height == 0 {
                return Err("Snapshot dimensions must be positive".to_string());
            }
            let slot: AsyncSlot<Retained<NSImage>> = Rc::new(RefCell::new(None));
            let sink = slot.clone();
            let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = if !error.is_null() {
                    let message = unsafe { (*error).localizedDescription() }.to_string();
                    Err(format!("WebKit could not capture the image: {message}"))
                } else {
                    unsafe { Retained::retain(image) }
                        .ok_or_else(|| "WebKit did not return an image snapshot".to_string())
                };
                *sink.borrow_mut() = Some(result);
            });
            let config = unsafe { WKSnapshotConfiguration::new(self.mtm) };
            let rect = CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize {
                    width: self.viewport_width,
                    height: self.viewport_height,
                },
            };
            let snapshot_width = NSNumber::new_f64(f64::from(expected_width));
            unsafe {
                config.setRect(rect);
                config.setSnapshotWidth(Some(&snapshot_width));
                config.setAfterScreenUpdates(true);
                self.webview
                    .takeSnapshotWithConfiguration_completionHandler(Some(&config), &completion);
            }
            let image = wait_for_slot(slot, "Timed out waiting for WebKit to capture the image")?;
            let tiff = image
                .TIFFRepresentation()
                .ok_or_else(|| "Could not read the WebKit image snapshot".to_string())?;
            let decoded =
                image::load_from_memory_with_format(&tiff.to_vec(), image::ImageFormat::Tiff)
                    .map_err(|error| {
                        format!("Could not decode the WebKit image snapshot: {error}")
                    })?
                    .to_rgba8();
            let normalized =
                if decoded.width() == expected_width && decoded.height() == expected_height {
                    decoded
                } else {
                    image::imageops::resize(
                        &decoded,
                        expected_width,
                        expected_height,
                        FilterType::Lanczos3,
                    )
                };
            Ok(normalized.into_raw())
        }
    }

    fn wait_for_slot<T>(slot: AsyncSlot<T>, timeout_message: &str) -> Result<T, String> {
        let deadline = Instant::now() + CAPTURE_TIMEOUT;
        loop {
            if slot.borrow().is_some() {
                return slot.borrow_mut().take().unwrap();
            }
            if Instant::now() >= deadline {
                return Err(timeout_message.to_string());
            }
            tick_run_loop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NavigationLoadState, navigation_load_result};

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
}
