package com.familycounter.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/index.html";
    private WebView webView;
    private boolean layoutChecked = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            setContentView(R.layout.activity_main);
            disableFullscreenMode();

            webView = findViewById(R.id.webview);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (layoutChecked || url == null) return;
                    if (url.contains("app.js")) {
                        view.loadUrl(START_URL);
                        return;
                    }
                    layoutChecked = true;
                    view.evaluateJavascript(
                        "(document.querySelector('.app') || document.getElementById('bootErrorScreen')) ? 'ok' : 'bad'",
                        value -> {
                            if ("\"bad\"".equals(value)) {
                                showAssetError(
                                    "Не загрузился index.html.\n"
                                    + "В assets должен быть HTML, а не текст app.js.\n"
                                    + "Пересоберите APK или обновите index.html на сайте."
                                );
                            }
                        }
                    );
                }
            });

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
                    if (callback != null) {
                        callback.onCustomViewHidden();
                    }
                }
            });

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }

            webView.loadUrl(START_URL);
        } catch (Exception error) {
            showAssetError("Краш Android при запуске:\n" + error.toString());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        disableFullscreenMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            disableFullscreenMode();
        }
    }

    /** Системные панели (время, заряд, Назад/Домой) всегда видны — без immersive. */
    private void disableFullscreenMode() {
        if (getWindow() == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(Color.parseColor("#0f172a"));
            getWindow().setNavigationBarColor(Color.parseColor("#0f172a"));
        }

        View decorView = getWindow().getDecorView();
        if (decorView == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        } else {
            decorView.setSystemUiVisibility(0);
        }
    }

    private void showAssetError(String message) {
        TextView crashView = new TextView(this);
        crashView.setTextColor(Color.WHITE);
        crashView.setBackgroundColor(Color.RED);
        crashView.setPadding(16, 16, 16, 16);
        crashView.setText(message);
        setContentView(crashView);
        disableFullscreenMode();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){return window.handleAppBackNavigation&&window.handleAppBackNavigation()?'1':'0';})()",
            value -> {
                if (!"\"1\"".equals(value)) {
                    super.onBackPressed();
                }
            }
        );
    }
}
