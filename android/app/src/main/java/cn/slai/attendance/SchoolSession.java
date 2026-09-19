package cn.slai.attendance;

import android.content.Context;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import androidx.webkit.UserAgentMetadata;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.Collections;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class SchoolSession {
    static final String PORTAL = "https://stu.slai.edu.cn/";
    static final Set<String> METHODS = new java.util.HashSet<>(java.util.Arrays.asList("findAttendanceUrl", "extractAttendance", "extractSwipePage", "setSwipePageSize", "advanceSwipePage"));
    final WebView web;
    final Handler handler = new Handler(Looper.getMainLooper());
    final String reader;
    NativeResult pending;
    Runnable deadline;
    int generation;
    boolean collecting, interrupted, complete, navigating, rendererGone, pageFailed;
    String startedUrl = "";
    java.util.function.BiConsumer<String, JSONObject> visibleError = (code, details) -> {};
    Runnable visibleLoaded = () -> {};

    SchoolSession(Context context) throws java.io.IOException {
        try (java.io.InputStream input = context.getAssets().open("web/page-reader.js"); java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192]; int size; while ((size = input.read(chunk)) != -1) bytes.write(chunk, 0, size);
            reader = bytes.toString("UTF-8");
        }
        web = new WebView(context);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setSaveFormData(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        Matcher match = Pattern.compile("Chrome/(\\d+(?:\\.\\d+){3})").matcher(WebSettings.getDefaultUserAgent(context));
        String version = match.find() ? match.group(1) : "120.0.0.0";
        String major = version.split("\\.")[0];
        settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + version + " Safari/537.36");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
            UserAgentMetadata.BrandVersion brand = new UserAgentMetadata.BrandVersion.Builder()
                .setBrand("Chromium").setMajorVersion(major).setFullVersion(version).build();
            WebSettingsCompat.setUserAgentMetadata(settings, new UserAgentMetadata.Builder()
                .setBrandVersionList(Collections.singletonList(brand)).setFullVersion(version)
                .setPlatform("Windows").setPlatformVersion("10.0.0").setArchitecture("x86")
                .setBitness(64).setMobile(false).setModel("").setWow64(false).build());
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) { return true; }
        });
        web.setWebViewClient(new Client());
    }

    static boolean allowed(String raw) {
        if (raw == null) return false;
        try {
            java.net.URI uri = new java.net.URI(raw);
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
                && ("stu.slai.edu.cn".equals(uri.getHost()) || "sts.slai.edu.cn".equals(uri.getHost()));
        } catch (java.net.URISyntaxException ignored) { return false; }
    }
    JSONObject state() {
        if (rendererGone) return NativeResult.object("id", 1, "url", "about:blank", "status", "loading");
        return NativeResult.object("id", 1, "url", web.getUrl() == null ? "about:blank" : web.getUrl(), "status", complete ? "complete" : "loading");
    }
    void begin(NativeResult result) {
        if (rendererGone) { result.fail("ANDROID_RENDERER_GONE"); return; }
        if (collecting) { result.fail("ANDROID_BUSY"); return; }
        collecting = true; interrupted = false; result.ok(true);
    }
    void navigate(String url, NativeResult result) {
        if (!collecting || interrupted) { result.fail("ANDROID_COLLECTION_INTERRUPTED"); return; }
        if (!allowed(url)) { result.fail("PORTAL_URL"); return; }
        if (pending != null) { result.fail("ANDROID_BUSY"); return; }
        pending = result; complete = false; navigating = true;
        deadline = () -> fail("PAGE_TIMEOUT", NativeResult.object("timeoutMs", 30000, "operation", "navigate"));
        handler.postDelayed(deadline, 30000);
        web.loadUrl(url);
    }
    void read(String method, NativeResult result) {
        if (!collecting || interrupted) { result.fail("ANDROID_COLLECTION_INTERRUPTED"); return; }
        if (!METHODS.contains(method)) { result.fail("SCRIPT_PERMISSION"); return; }
        if (!allowed(web.getUrl())) { result.fail("PORTAL_URL"); return; }
        if ("sts.slai.edu.cn".equals(Uri.parse(web.getUrl()).getHost())) { result.fail("AUTH_EXPIRED"); return; }
        if (!complete) { result.fail("SCRIPT_CONTEXT_LOST"); return; }
        if (pending != null) { result.fail("ANDROID_BUSY"); return; }
        final int before = generation;
        pending = result; navigating = false;
        deadline = () -> fail("ANDROID_READER_TIMEOUT", NativeResult.object("timeoutMs", 5000));
        handler.postDelayed(deadline, 5000);
        // Bundle-owned script and a fixed method name only; no page-provided JS.
        String script = "(() => { try { " + reader + ";return {ok:true,value:globalThis.__slaiAttendance[" + JSONObject.quote(method) + "]()}; } catch (_) {return {ok:false};} })()";
        web.evaluateJavascript(script, raw -> {
            if (pending != result) return;
            if (before != generation && !"advanceSwipePage".equals(method) && !"setSwipePageSize".equals(method)) { fail("SCRIPT_CONTEXT_LOST", new JSONObject()); return; }
            try {
                JSONObject response = new JSONObject(raw);
                if (!response.optBoolean("ok")) { fail("UNEXPECTED_ERROR", new JSONObject()); return; }
                succeed(response.opt("value"));
            } catch (Exception ignored) { fail("SCRIPT_CONTEXT_LOST", new JSONObject()); }
        });
    }
    void succeed(Object value) {
        NativeResult result = pending; pending = null;
        if (deadline != null) handler.removeCallbacks(deadline);
        if (result != null) result.ok(value);
    }
    void fail(String code, JSONObject details) {
        pageFailed = true;
        NativeResult result = pending; pending = null;
        if (deadline != null) handler.removeCallbacks(deadline);
        if (result != null) result.fail(code, details);
        else if (!collecting) visibleError.accept(code, details);
    }
    void interrupt() {
        if (!collecting) return;
        interrupted = true;
        fail("ANDROID_COLLECTION_INTERRUPTED", new JSONObject());
        if (!rendererGone) web.stopLoading();
    }
    void close() {
        complete = false;
        if (!rendererGone) { web.stopLoading(); web.loadUrl("about:blank"); web.clearHistory(); }
    }
    void destroy() { interrupt(); handler.removeCallbacksAndMessages(null); if (!rendererGone) web.destroy(); }

    class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (allowed(request.getUrl().toString())) return false;
            if (request.isForMainFrame()) fail("PORTAL_URL", new JSONObject());
            return true;
        }
        @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
            generation++; complete = false; pageFailed = false; startedUrl = url;
            if (!"about:blank".equals(url) && !allowed(url)) { view.stopLoading(); fail("PORTAL_URL", new JSONObject()); }
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (pageFailed || !url.equals(startedUrl) || !url.equals(view.getUrl()) || !allowed(url)) return;
            complete = true; CookieManager.getInstance().flush();
            if (pending != null && navigating) succeed(state());
            else if (!collecting) visibleLoaded.run();
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String code = switch (error.getErrorCode()) {
                case ERROR_HOST_LOOKUP -> "ANDROID_DNS_FAILED";
                case ERROR_CONNECT -> "ANDROID_CONNECT_FAILED";
                case ERROR_TIMEOUT -> "PAGE_TIMEOUT";
                case ERROR_FAILED_SSL_HANDSHAKE -> "ANDROID_TLS_FAILED";
                default -> "PAGE_NETWORK_ERROR";
            };
            fail(code, NativeResult.object("operation", "navigate"));
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame()) fail("ANDROID_HTTP_FAILED", NativeResult.object("httpStatus", response.getStatusCode(), "operation", "navigate"));
        }
        @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
            ssl.cancel(); fail("ANDROID_TLS_FAILED", NativeResult.object("operation", "navigate"));
        }
        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            rendererGone = true; interrupted = true; fail("ANDROID_RENDERER_GONE", new JSONObject());
            if (view.getParent() instanceof android.view.ViewGroup parent) parent.removeView(view);
            view.destroy(); return true;
        }
    }
}
