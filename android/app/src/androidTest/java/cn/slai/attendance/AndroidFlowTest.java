package cn.slai.attendance;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.lifecycle.Lifecycle;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

@RunWith(AndroidJUnit4.class)
public final class AndroidFlowTest {
    MainActivity activity;
    final List<Integer> pages = Collections.synchronizedList(new ArrayList<>());
    final AtomicInteger requests = new AtomicInteger();
    final AtomicBoolean desktopHeaders = new AtomicBoolean(true);
    final AtomicBoolean widePageSize = new AtomicBoolean(true);
    volatile String mode = "normal";

    void main(Runnable action) { InstrumentationRegistry.getInstrumentation().runOnMainSync(action); }
    String shellOutput(String command) throws IOException {
        // UiAutomation executes an argument vector, not shell operators.
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new android.os.ParcelFileDescriptor.AutoCloseInputStream(
            InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command)), StandardCharsets.UTF_8))) {
            StringBuilder output = new StringBuilder(); String line;
            while ((line = reader.readLine()) != null) output.append(line);
            return output.toString();
        }
    }
    Object eval(WebView view, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        main(() -> view.evaluateJavascript(script, raw -> { value.set(raw); done.countDown(); }));
        assertTrue("WebView script callback exceeded 10 seconds", done.await(10, TimeUnit.SECONDS));
        return new JSONTokener(value.get()).nextValue();
    }
    void until(String script) throws Exception {
        long end = System.currentTimeMillis() + 40000;
        while (System.currentTimeMillis() < end) {
            if (Boolean.TRUE.equals(eval(activity.dashboard, script))) return;
            Thread.sleep(100);
        }
        fail("Condition timed out: " + script);
    }
    byte[] asset(String name) throws IOException {
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            return output.toByteArray();
        }
    }
    WebResourceResponse html(String value) { return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8))); }
    void installFixture() {
        main(() -> activity.school.web.setWebViewClient(activity.school.new Client() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                requests.incrementAndGet();
                String userAgent = "";
                for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) if (header.getKey().equalsIgnoreCase("User-Agent")) userAgent = header.getValue();
                if (!userAgent.contains("Windows NT") || userAgent.contains("Mobile") || userAgent.contains("Android")) {
                    desktopHeaders.set(false); return html("<h1>虚构的不同手机页面</h1>");
                }
                String cookies = CookieManager.getInstance().getCookie(SchoolSession.PORTAL);
                String host = request.getUrl().getHost(), route = request.getUrl().getPath();
                if ("sts.slai.edu.cn".equals(host)) return html("<button id=fixtureLogin onclick=\"document.cookie='fixture_session=1; Domain=.slai.edu.cn; Path=/; Secure; SameSite=Lax';location.href='https://stu.slai.edu.cn/'\">虚构登录</button>");
                if (cookies == null || !cookies.contains("fixture_session=1")) return html("<script>location.replace('https://sts.slai.edu.cn/signin')</script>");
                if (route.endsWith("/attendList")) return html("<h1>月度考勤统计汇总</h1><input value=2030-04><p>学号: 000000000</p><table><tr><td>2030-04-08</td><td>周一</td><td>工作日</td><td>02:00:00</td></tr></table>");
                if (route.endsWith("/list")) {
                    if (mode.equals("http")) return new WebResourceResponse("text/html", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                    String page = request.getUrl().getQueryParameter("pageNo");
                    if ((page == null || mode.equals("wide")) && !"90".equals(request.getUrl().getQueryParameter("pageSize"))) widePageSize.set(false);
                    pages.add(page == null ? 1 : Integer.parseInt(page));
                    try {
                        if (page == null) return new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(asset(mode.equals("empty") ? "swipe-empty.html" : mode.equals("wide") ? "swipe-wide.html" : "swipe.html")));
                        return new WebResourceResponse("application/json", "UTF-8", new ByteArrayInputStream(asset((mode.equals("wide") ? "wide-" : "") + "page-" + page + ".json")));
                    } catch (IOException ignored) { return html("<h1>Missing synthetic fixture</h1>"); }
                }
                return html("<a href='/a/edu/acm/swipe/attendList'>学生考勤统计查询</a>");
            }
        }));
    }
    void clearCookies() throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        main(() -> CookieManager.getInstance().removeAllCookies(value -> { CookieManager.getInstance().flush(); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS));
    }
    JSONObject cached() throws Exception { return new JSONObject(new String(activity.stateFile.readFully(), StandardCharsets.UTF_8)); }
    void refresh() throws Exception {
        eval(activity.dashboard, "document.querySelector('#refresh').click();true");
        until("!document.querySelector('#refresh').disabled");
    }
    void setClock() throws Exception {
        eval(activity.dashboard, "(() => { const NativeDate=Date;const offset=NativeDate.parse('2030-04-08T12:00:00+08:00')-NativeDate.now();globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[NativeDate.now()+offset]));}static now(){return NativeDate.now()+offset;}};return true;})()");
    }
    void login() throws Exception {
        eval(activity.dashboard, "document.querySelector('#login').click();true");
        long end = System.currentTimeMillis() + 20000;
        while (!Boolean.TRUE.equals(eval(activity.school.web, "!!document.querySelector('#fixtureLogin')")) && System.currentTimeMillis() < end) Thread.sleep(100);
        assertEquals(true, eval(activity.school.web, "!!document.querySelector('#fixtureLogin')"));
        assertEquals("undefined", eval(activity.school.web, "typeof SlaiNative"));
        assertTrue(((String) eval(activity.school.web, "navigator.userAgent")).contains("Windows NT"));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
            assertEquals(false, eval(activity.school.web, "navigator.userAgentData.mobile"));
            assertEquals("Windows", eval(activity.school.web, "navigator.userAgentData.platform"));
        }
        eval(activity.school.web, "document.querySelector('#fixtureLogin').click();true");
        Thread.sleep(500);
        assertFalse(activity.school.collecting);
        main(() -> {
            // Exercise the actual native button, including a rapid second tap.
            activity.schoolPanel.getChildAt(0).performClick();
            activity.schoolPanel.getChildAt(0).performClick();
        });
        until("document.querySelector('#refresh').disabled");
        until("!document.querySelector('#refresh').disabled");
        assertFalse(activity.schoolVisible);
    }
    @Test public void finalApkManualFlow() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(value -> activity = value);
            assertNotNull(activity.dashboard); assertNotNull(activity.school);
            clearCookies(); main(() -> { activity.stateFile.delete(); activity.dashboard.reload(); });
            until("typeof currentState !== 'undefined' && !!currentState && typeof refresh === 'function'");
            installFixture(); setClock();
            assertEquals(0, requests.get());
            assertFalse(activity.school.collecting);
            main(() -> {
                assertFalse(activity.dashboard.getSettings().getAllowFileAccess());
                assertFalse(activity.school.web.getSettings().getAllowFileAccess());
            });
            login();
            String cookie = CookieManager.getInstance().getCookie(SchoolSession.PORTAL);
            assertTrue(cookie != null && cookie.contains("fixture_session=1"));
            JSONObject good = cached();
            assertEquals(good.optJSONObject("diagnostic") == null ? "" : good.getJSONObject("diagnostic").optString("code"), "ok", good.getString("status"));
            assertEquals(6, good.getJSONArray("todaySwipes").length());
            assertTrue(good.isNull("nextRefreshAt"));
            assertEquals(Arrays.asList(1, 2, 3), new ArrayList<>(pages));
            assertEquals("03:00:00", eval(activity.dashboard, "document.querySelector('#todayDuration').textContent"));
            assertTrue(desktopHeaders.get());
            assertFalse(good.toString().contains("000000000"));
            assertFalse(good.toString().contains("fixture_session"));
            assertFalse(good.toString().contains("https://"));
            int completed = requests.get();
            Thread.sleep(1500); assertEquals(completed, requests.get());

            // Leaving the foreground cancels this attempt; resume never starts another.
            pages.clear();
            eval(activity.dashboard, "document.querySelector('#refresh').click();true");
            long firstPageDeadline = System.currentTimeMillis() + 15000;
            while (pages.isEmpty() && System.currentTimeMillis() < firstPageDeadline) Thread.sleep(50);
            assertFalse("Manual collection did not reach the first page", pages.isEmpty());
            scenario.moveToState(Lifecycle.State.CREATED);
            int stopped = requests.get(); Thread.sleep(1800); assertEquals(stopped, requests.get());
            scenario.moveToState(Lifecycle.State.RESUMED);
            until("!document.querySelector('#refresh').disabled");
            assertEquals("ANDROID_COLLECTION_INTERRUPTED", cached().getJSONObject("diagnostic").getString("code"));
            assertEquals(good.getString("updatedAt"), cached().getString("updatedAt"));
            int resumed = requests.get(); Thread.sleep(1600); assertEquals(resumed, requests.get());
            refresh(); good = cached(); assertEquals("ok", good.getString("status"));

            mode = "http"; refresh();
            JSONObject failed = cached();
            assertEquals("partial", failed.getString("status"));
            assertEquals("ANDROID_HTTP_FAILED", failed.getJSONObject("diagnostic").getString("code"));
            assertEquals(403, failed.getJSONObject("diagnostic").getInt("httpStatus"));
            assertEquals(good.getString("updatedAt"), failed.getString("updatedAt"));
            assertEquals("03:00:00", eval(activity.dashboard, "document.querySelector('#todayDuration').textContent"));
            mode = "empty"; pages.clear(); refresh();
            JSONObject empty = cached();
            assertEquals("ok", empty.getString("status"));
            assertTrue(empty.isNull("diagnostic"));
            assertEquals(0, empty.getJSONArray("todaySwipes").length());
            assertEquals(0, empty.getJSONObject("lastCompleteToday").getJSONArray("swipes").length());
            assertEquals("00:00:00", eval(activity.dashboard, "document.querySelector('#todayDuration').textContent"));
            assertEquals(Arrays.asList(1), new ArrayList<>(pages));
            mode = "wide"; pages.clear(); refresh();
            assertEquals("ok", cached().getString("status"));
            assertEquals(6, cached().getJSONArray("todaySwipes").length());
            assertEquals(Arrays.asList(1, 1, 2), new ArrayList<>(pages));
            assertEquals("03:00:00", eval(activity.dashboard, "document.querySelector('#todayDuration').textContent"));
            // Collection closes the school WebView; verify the captured request
            // sizes instead of inspecting a table that has already been cleared.
            assertTrue(widePageSize.get());
            mode = "normal"; clearCookies(); refresh();
            assertEquals("auth", cached().getString("status"));
            assertEquals("AUTH_EXPIRED", cached().getJSONObject("diagnostic").getString("code"));
            pages.clear(); login();
            assertEquals("ok", cached().getString("status"));
            assertTrue(cached().isNull("diagnostic"));
            assertEquals(Arrays.asList(1, 2, 3), new ArrayList<>(pages));
            // Cache and school session survive Activity recreation, without a refresh.
            JSONObject beforeRecreate = cached(); int beforeRequests = requests.get();
            scenario.recreate(); scenario.onActivity(value -> activity = value);
            until("typeof currentState !== 'undefined' && !!currentState && currentState.status === 'ok'");
            installFixture(); setClock();
            assertEquals(beforeRecreate.getString("updatedAt"), cached().getString("updatedAt"));
            assertEquals(beforeRequests, requests.get());
            assertTrue(CookieManager.getInstance().getCookie(SchoolSession.PORTAL).contains("fixture_session=1"));
            refresh(); assertEquals("ok", cached().getString("status"));
            Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            File output = new File(activity.getExternalFilesDir(null), "android-verified.png");
            try (FileOutputStream stream = new FileOutputStream(output)) { screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream); }
            // Gradle uninstalls the app after testing, so retain only this synthetic
            // screenshot in the emulator shell's temporary directory first.
            shellOutput("cp /sdcard/Android/data/cn.slai.attendance/files/android-verified.png /data/local/tmp/slai-android-verified.png");
            assertEquals(String.valueOf(output.length()), shellOutput("stat -c %s /data/local/tmp/slai-android-verified.png"));
            eval(activity.dashboard, "document.querySelector('#logout').click();document.querySelector('#confirmLogout').click();true");
            until("document.querySelector('#todayDuration').textContent === '--:--:--'");
            assertFalse(activity.stateFile.getBaseFile().exists());
            assertNull(CookieManager.getInstance().getCookie(SchoolSession.PORTAL));
        }
    }
}
