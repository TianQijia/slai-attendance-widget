package cn.slai.attendance;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.util.AtomicFile;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String HOME = ORIGIN + "/assets/web/index.html";
    static final String SCHOOL_HINT = "学校页面可双指缩放，也可用上方按钮调整大小。“返回考勤”会刷新一次。";
    WebView dashboard;
    SchoolSession school;
    FrameLayout root;
    LinearLayout schoolPanel;
    TextView schoolStatus;
    Button returnButton, zoomOutButton, zoomInButton;
    AtomicFile stateFile;
    boolean schoolVisible;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try { createViews(); }
        catch (Exception ignored) { fatal("ANDROID_WEBVIEW_UNAVAILABLE", "应用无法启动内置浏览器。请安装或更新 Android System WebView / Chrome 后重新打开应用。"); }
    }
    void createViews() throws IOException {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            fatal("ANDROID_WEBVIEW_UNAVAILABLE", "内置浏览器不支持安全的本机通信。请更新 Android System WebView / Chrome 后重新打开应用。"); return;
        }
        WebView.setWebContentsDebuggingEnabled(false);
        stateFile = new AtomicFile(new File(getFilesDir(), "attendance.json"));
        root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        school = new SchoolSession(this);
        schoolPanel = new LinearLayout(this); schoolPanel.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this);
        returnButton = new Button(this); returnButton.setText("返回考勤"); returnButton.setOnClickListener(view -> returnToAttendance());
        zoomOutButton = new Button(this); zoomOutButton.setText("缩小"); zoomOutButton.setOnClickListener(view -> { if (!school.rendererGone) school.web.zoomOut(); });
        zoomInButton = new Button(this); zoomInButton.setText("放大"); zoomInButton.setOnClickListener(view -> { if (!school.rendererGone) school.web.zoomIn(); });
        toolbar.addView(returnButton, new LinearLayout.LayoutParams(0, -2, 1));
        toolbar.addView(zoomOutButton); toolbar.addView(zoomInButton);
        schoolStatus = new TextView(this); schoolStatus.setText(SCHOOL_HINT);
        schoolStatus.setPadding(16, 8, 16, 8); schoolStatus.setTextIsSelectable(true);
        school.visibleError = (code, details) -> schoolStatus.setText(navigationDiagnostic(code, details));
        school.visibleLoaded = () -> schoolStatus.setText(SCHOOL_HINT);
        schoolPanel.addView(toolbar); schoolPanel.addView(schoolStatus);
        schoolPanel.addView(school.web, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(schoolPanel, new FrameLayout.LayoutParams(-1, -1));
        dashboard = new WebView(this);
        dashboard.getSettings().setJavaScriptEnabled(true);
        dashboard.getSettings().setAllowFileAccess(false);
        dashboard.getSettings().setAllowContentAccess(false);
        dashboard.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        dashboard.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) { return true; }
        });
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        dashboard.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                return response != null ? response : new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !HOME.equals(request.getUrl().toString()); }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                school.interrupt();
                if (view.getParent() instanceof android.view.ViewGroup parent) parent.removeView(view);
                dashboard = null; view.destroy();
                fatal("ANDROID_RENDERER_GONE", "内置浏览器进程已结束。请关闭应用后重新打开；上次完整考勤缓存仍保留。"); return true;
            }
        });
        WebViewCompat.addWebMessageListener(dashboard, "SlaiNative", java.util.Collections.singleton(ORIGIN), (view, message, origin, mainFrame, proxy) -> {
            if (!mainFrame || !ORIGIN.equals(origin.toString()) || !HOME.equals(view.getUrl())) return;
            try {
                String data = message.getData();
                if (data == null || data.length() > 262144) return;
                JSONObject request = new JSONObject(data);
                String id = request.getString("id");
                if (!id.matches("[0-9]{1,12}")) return;
                NativeResult result = new NativeResult() {
                    boolean sent;
                    private void reply(JSONObject response) {
                        if (sent) return; sent = true;
                        try { proxy.postMessage(response.toString()); } catch (RuntimeException ignored) { /* View has closed. */ }
                    }
                    public void ok(Object value) { reply(NativeResult.object("id", id, "ok", true, "value", value)); }
                    public void fail(String code, JSONObject details) { reply(NativeResult.object("id", id, "ok", false, "code", code, "details", details)); }
                };
                handle(request.getString("operation"), request.optJSONObject("args"), result);
            } catch (Exception ignored) { /* Unparseable messages cannot identify a request safely. */ }
        });
        root.addView(dashboard, new FrameLayout.LayoutParams(-1, -1));
        // Both WebViews stay attached while collecting, so desktop layout and
        // asynchronous school scripts retain a real viewport under the dashboard.
        updateTheme(); dashboard.loadUrl(HOME);
    }
    void handle(String operation, JSONObject args, NativeResult result) {
        if (args == null) args = new JSONObject();
        try {
            switch (operation) {
                case "state.read" -> {
                    if (!stateFile.getBaseFile().exists()) result.ok(NativeResult.object("schemaVersion", 5, "status", "loading"));
                    else {
                        try { result.ok(new JSONObject(new String(stateFile.readFully(), StandardCharsets.UTF_8))); }
                        catch (Exception ignored) { result.fail("STORAGE_READ_FAILED"); }
                    }
                }
                case "state.write" -> {
                    FileOutputStream output = null;
                    try {
                        JSONObject state = args.getJSONObject("state");
                        byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
                        if (bytes.length > 262144 || state.optInt("schemaVersion") != 5) { result.fail("INVALID_SCHEMA"); return; }
                        output = stateFile.startWrite(); output.write(bytes); stateFile.finishWrite(output); result.ok(true);
                    } catch (Exception ignored) { if (output != null) stateFile.failWrite(output); result.fail("STORAGE_WRITE_FAILED"); }
                }
                case "view.read" -> result.ok(getPreferences(MODE_PRIVATE).getString("desktopView", "calendar"));
                case "view.write" -> {
                    String value = args.optString("view");
                    if (!("calendar".equals(value) || "list".equals(value))) { result.fail("INVALID_SCHEMA"); return; }
                    if (getPreferences(MODE_PRIVATE).edit().putString("desktopView", value).commit()) result.ok(true);
                    else result.fail("STORAGE_WRITE_FAILED");
                }
                case "collection.begin" -> school.begin(result);
                case "collection.end" -> { school.collecting = false; result.ok(true); }
                case "school.navigate" -> school.navigate(args.optString("url"), result);
                case "school.state" -> {
                    if (school.rendererGone) result.fail("ANDROID_RENDERER_GONE");
                    else if (school.interrupted) result.fail("ANDROID_COLLECTION_INTERRUPTED");
                    else result.ok(school.state());
                }
                case "school.read" -> school.read(args.optString("method"), result);
                case "school.close" -> { school.close(); result.ok(true); }
                case "school.show" -> {
                    if (school.rendererGone) { result.fail("ANDROID_RENDERER_GONE"); return; }
                    if (school.collecting) { result.fail("ANDROID_BUSY"); return; }
                    schoolVisible = true; schoolPanel.bringToFront();
                    schoolStatus.setText(SCHOOL_HINT);
                    school.web.loadUrl(SchoolSession.PORTAL); result.ok(true);
                }
                case "school.logout" -> {
                    if (school.collecting) { result.fail("ANDROID_BUSY"); return; }
                    school.close();
                    CookieManager.getInstance().removeAllCookies(removed -> {
                        CookieManager.getInstance().flush(); WebStorage.getInstance().deleteAllData();
                        stateFile.delete(); if (!school.rendererGone) school.web.clearCache(true); result.ok(true);
                    });
                }
                default -> result.fail("ANDROID_BRIDGE_UNAVAILABLE");
            }
        } catch (Exception ignored) { result.fail("UNEXPECTED_ERROR"); }
    }
    void hideSchool() { schoolVisible = false; CookieManager.getInstance().flush(); if (dashboard != null) dashboard.bringToFront(); }
    void returnToAttendance() {
        if (!schoolVisible) return;
        hideSchool();
        // The explicit return tap uses the same guarded UI refresh as its button.
        if (dashboard != null && HOME.equals(dashboard.getUrl())) dashboard.evaluateJavascript("document.getElementById('refresh')?.click();", null);
    }
    static String navigationDiagnostic(String code, JSONObject details) {
        String reason = switch (code) {
            case "ANDROID_DNS_FAILED" -> "学校域名解析失败。请检查手机网络能否打开学校网站。";
            case "ANDROID_CONNECT_FAILED" -> "未能建立到学校页面的连接。请检查手机网络及学校网站是否可访问。";
            case "ANDROID_TLS_FAILED" -> "学校 HTTPS 证书或握手错误。请核对手机日期时间及学校证书；应用不会忽略证书错误。";
            case "ANDROID_HTTP_FAILED" -> "学校页面返回 HTTP " + details.optInt("httpStatus") + "。请核对学校服务状态后重试。";
            case "PAGE_TIMEOUT" -> "学校页面加载超时，尚不能确定原因。请返回后重新打开学校页面核对加载情况。";
            case "PORTAL_URL" -> "学校页面跳转到不支持的地址。请返回考勤并重新打开学校首页。";
            case "ANDROID_RENDERER_GONE" -> "内置浏览器进程已结束。请关闭应用后重新打开。";
            default -> "浏览器报告页面加载错误，直接原因尚未识别。请保留此代码并核对学校页面是否可访问。";
        };
        return "错误代码：" + code + "\n失败阶段：学校页面导航\n直接原因及下一步：" + reason + "\n可长按选择并复制此诊断。";
    }
    void updateTheme() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = dark ? Color.rgb(25, 22, 28) : Color.rgb(255, 255, 255);
        root.setBackgroundColor(color); dashboard.setBackgroundColor(color); schoolPanel.setBackgroundColor(color);
    }
    void fatal(String code, String message) {
        TextView text = new TextView(this); text.setTextSize(16); text.setPadding(32, 64, 32, 32); text.setTextIsSelectable(true);
        text.setText(message + "\n\n错误代码：" + code + "\n失败阶段：" + ("ANDROID_RENDERER_GONE".equals(code) ? "运行安卓界面" : "启动安卓界面") + "\n可长按选择并复制此诊断。"); setContentView(text);
    }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); if (root != null && dashboard != null) updateTheme(); }
    @Override public void onBackPressed() {
        if (schoolVisible) { if (!school.rendererGone && school.web.canGoBack()) school.web.goBack(); else hideSchool(); }
        else super.onBackPressed();
    }
    @Override protected void onStart() { super.onStart(); if (dashboard != null) dashboard.resumeTimers(); }
    @Override protected void onStop() { if (school != null) school.interrupt(); if (dashboard != null) dashboard.pauseTimers(); super.onStop(); }
    @Override protected void onDestroy() {
        if (school != null) school.destroy(); if (dashboard != null) dashboard.destroy(); super.onDestroy();
    }
}
