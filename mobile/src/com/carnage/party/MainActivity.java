package com.carnage.party;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final String PREFS = "carnage";
    private static final String KEY_SERVER = "server_url";
    private static final String APP_INDEX = "file:///android_asset/www/index.html";
    private static final int REQ_MEDIA = 41;
    private static final int REQ_FILE = 42;

    private WebView web;
    private SharedPreferences prefs;
    private LinearLayout errorPanel;
    private TextView errorText;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> pendingFileCallback;
    private boolean overlayOpen = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 12, 22));

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(18, 12, 22));
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        errorPanel = buildErrorPanel();
        root.addView(errorPanel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        configureWebView();
        web.addJavascriptInterface(new Bridge(), "CarnageAndroid");
        web.loadUrl(APP_INDEX);
    }

    private LinearLayout buildErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(28), dp(28), dp(28), dp(28));
        panel.setBackgroundColor(Color.rgb(18, 12, 22));
        panel.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("Не удалось открыть Carnage Party");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 23);
        title.setGravity(Gravity.CENTER);
        panel.addView(title);

        errorText = new TextView(this);
        errorText.setTextColor(Color.rgb(196, 165, 210));
        errorText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(10), 0, dp(26));
        panel.addView(errorText);

        Button retry = makeButton("Повторить");
        retry.setOnClickListener(v -> {
            errorPanel.setVisibility(View.GONE);
            web.loadUrl(APP_INDEX);
        });
        panel.addView(retry);

        Button change = makeButton("Настройки сервера");
        change.setOnClickListener(v -> showServerDialog());
        panel.addView(change);

        return panel;
    }

    private Button makeButton(String text) {
        Button button = new Button(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                dp(240), ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(8);
        button.setLayoutParams(params);
        button.setText(text);
        button.setAllCaps(false);
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(
                settings.getUserAgentString() + " CarnagePartyMobile/" + Config.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (url != null && url.startsWith("file:")) {
                    errorPanel.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                if (scheme.equals("file") || scheme.equals("about") || scheme.equals("javascript")) {
                    return false;
                }
                if (scheme.equals("http") || scheme.equals("https")) {
                    String serverHost = Uri.parse(getServerUrl()).getHost();
                    String host = uri.getHost();
                    if (serverHost != null && host != null && serverHost.equalsIgnoreCase(host)) {
                        return false;
                    }
                }
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && url.startsWith("file:")) {
                    errorPanel.setVisibility(View.GONE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showAssetError();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(fileChooserType(params));
                if (params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(intent, "Выберите файл"), REQ_FILE);
                    return true;
                } catch (Exception error) {
                    pendingFileCallback = null;
                    return false;
                }
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            if (url == null || url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(this, "Сохраните файл через меню передачи", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                request.setTitle(fileName);
                request.setDescription("Carnage Party");
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "Скачивание: " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "Не удалось скачать файл", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private String fileChooserType(WebChromeClient.FileChooserParams params) {
        if (params == null) {
            return "*/*";
        }
        String[] accept = params.getAcceptTypes();
        if (accept == null || accept.length == 0) {
            return "*/*";
        }
        StringBuilder joined = new StringBuilder();
        for (String value : accept) {
            if (value != null) {
                joined.append(value.toLowerCase()).append(' ');
            }
        }
        String types = joined.toString();
        if (types.contains("image/") || types.contains(".jpg") || types.contains(".jpeg")
                || types.contains(".png") || types.contains(".webp") || types.contains(".gif")) {
            return "image/*";
        }
        if (types.contains("video/")) {
            return "video/*";
        }
        if (types.contains("audio/")) {
            return "audio/*";
        }
        return "*/*";
    }

    private void showAssetError() {
        errorText.setText(APP_INDEX);
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void handleWebPermission(PermissionRequest request) {
        boolean needsAudio = false;
        boolean needsVideo = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                needsAudio = true;
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                needsVideo = true;
            }
        }

        boolean audioOk = !needsAudio
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        boolean videoOk = !needsVideo
                || checkSelfPermission(Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;

        if (audioOk && videoOk) {
            request.grant(request.getResources());
            return;
        }

        pendingPermission = request;
        ArrayList<String> missing = new ArrayList<>();
        if (!audioOk) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!videoOk) {
            missing.add(Manifest.permission.CAMERA);
        }
        requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_MEDIA || pendingPermission == null) {
            return;
        }
        boolean allGranted = true;
        for (int result : results) {
            if (result != PackageManager.PERMISSION_GRANTED) {
                allGranted = false;
            }
        }
        if (allGranted) {
            pendingPermission.grant(pendingPermission.getResources());
        } else {
            pendingPermission.deny();
            Toast.makeText(
                    this,
                    "Разрешите микрофон и камеру в настройках Android",
                    Toast.LENGTH_LONG).show();
        }
        pendingPermission = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (pendingFileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        result = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            result[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        result = new Uri[]{data.getData()};
                    }
                }
                pendingFileCallback.onReceiveValue(result);
                pendingFileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String getServerUrl() {
        String url = prefs.getString(KEY_SERVER, "");
        if (url == null || url.trim().isEmpty()) {
            url = Config.DEFAULT_SERVER;
        }
        return normalize(url);
    }

    private static String normalize(String value) {
        String url = value == null ? "" : value.trim();
        if (url.isEmpty()) {
            return Config.DEFAULT_SERVER;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }

    private void showServerDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(getServerUrl());
        input.setSelectAllOnFocus(true);
        input.setSingleLine(true);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(8), dp(20), 0);

        TextView hint = new TextView(this);
        hint.setText("Адрес сервера, например http://188.234.161.207:3001");
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        hint.setPadding(0, 0, 0, dp(8));
        box.addView(hint);
        box.addView(input);

        new AlertDialog.Builder(this)
                .setTitle("Сервер Carnage Party")
                .setView(box)
                .setPositiveButton("Сохранить", (dialog, which) -> {
                    String value = normalize(input.getText().toString());
                    prefs.edit().putString(KEY_SERVER, value).apply();
                    errorPanel.setVisibility(View.GONE);
                    overlayOpen = false;
                    web.loadUrl(APP_INDEX);
                    Toast.makeText(this, "Сервер: " + value, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Отмена", null)
                .show();
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
        }
    }

    // Скачивает APK во внутренний кэш и открывает системный установщик.
    // Прогресс уходит в интерфейс событием carnage:update-progress.
    private void downloadUpdate(String url, String fileName) {
        final String targetName = sanitizeUpdateName(fileName);
        new Thread(() -> {
            HttpURLConnection connection = null;
            File destination = new File(getCacheDir(), targetName);
            try {
                URL address = new URL(url);
                connection = (HttpURLConnection) address.openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(45000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "Carnage-Party-Updater");
                connection.connect();
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IOException("HTTP " + status);
                }
                int total = connection.getContentLength();
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(destination);
                byte[] buffer = new byte[16384];
                long received = 0;
                int lastPercent = -1;
                int read;
                while ((read = input.read(buffer)) > 0) {
                    output.write(buffer, 0, read);
                    received += read;
                    if (total > 0) {
                        int percent = (int) (received * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            sendUpdateProgress("downloading", percent, received, total);
                        }
                    }
                }
                output.flush();
                output.close();
                input.close();
                sendUpdateProgress("downloaded", 100, received, total);
                installApk(destination);
            } catch (Exception error) {
                sendUpdateProgress("error", 0, 0, 0);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }).start();
    }

    private static String sanitizeUpdateName(String value) {
        String name = value == null ? "" : value.replaceAll("[^A-Za-z0-9._ -]", "");
        name = new File(name).getName();
        if (name.isEmpty() || !name.toLowerCase().endsWith(".apk")) {
            name = "Carnage-Party-Update.apk";
        }
        return name;
    }

    private void installApk(File file) {
        Uri uri = UpdateFileProvider.uriFor(file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        runOnUiThread(() -> {
            try {
                startActivity(intent);
            } catch (ActivityNotFoundException error) {
                sendUpdateProgress("error", 0, 0, 0);
            }
        });
    }

    private void sendUpdateProgress(String phase, int percent, long received, long total) {
        String script = "window.dispatchEvent(new CustomEvent('carnage:update-progress',{detail:{phase:'"
                + phase + "',percent:" + percent + ",received:" + received + ",total:" + total + "}}))";
        if (web == null) {
            return;
        }
        web.post(() -> {
            if (web != null) {
                web.evaluateJavascript(script, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (overlayOpen && web != null) {
            web.evaluateJavascript(
                    "window.dispatchEvent(new Event('carnage:back'))", null);
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("CarnageAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    public class Bridge {
        @JavascriptInterface
        public String getServerUrl() {
            return MainActivity.this.getServerUrl();
        }

        @JavascriptInterface
        public String setServerUrl(String value) {
            String normalized = normalize(value);
            prefs.edit().putString(KEY_SERVER, normalized).apply();
            return normalized;
        }

        @JavascriptInterface
        public String getVersion() {
            return Config.VERSION_NAME;
        }

        @JavascriptInterface
        public void openServerSettings() {
            runOnUiThread(MainActivity.this::showServerDialog);
        }

        @JavascriptInterface
        public void setOverlayOpen(boolean open) {
            overlayOpen = open;
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null || url.isEmpty()) {
                return;
            }
            runOnUiThread(() -> MainActivity.this.openExternal(Uri.parse(url)));
        }

        @JavascriptInterface
        public void downloadUpdate(String url, String fileName) {
            if (url == null || (!url.startsWith("http://") && !url.startsWith("https://"))) {
                sendUpdateProgress("error", 0, 0, 0);
                return;
            }
            MainActivity.this.downloadUpdate(url, fileName);
        }
    }
}
