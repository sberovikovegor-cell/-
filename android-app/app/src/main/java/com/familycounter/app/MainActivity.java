package com.familycounter.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public class MainActivity extends Activity {
    private WebView webView;
    private TextView errorLogView;
    private ScrollView errorScrollView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            FrameLayout root = new FrameLayout(this);
            webView = new WebView(this);
            root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ));

            errorLogView = new TextView(this);
            errorLogView.setTextColor(Color.WHITE);
            errorLogView.setBackgroundColor(Color.argb(230, 120, 20, 20));
            errorLogView.setTextSize(11f);
            errorLogView.setPadding(12, 8, 12, 8);
            errorLogView.setText("Диагностика запуска…\n");

            errorScrollView = new ScrollView(this);
            errorScrollView.addView(errorLogView);
            FrameLayout.LayoutParams errLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            );
            errorScrollView.setLayoutParams(errLp);
            errorScrollView.setVisibility(View.VISIBLE);
            root.addView(errorScrollView);

            setContentView(root);
            enterFullscreenMode();

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onReceivedError(
                    WebView view,
                    int errorCode,
                    String description,
                    String failingUrl
                ) {
                    appendError("Страница: " + description + " (" + errorCode + ")\n" + failingUrl);
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame()) {
                        String desc = error != null ? error.getDescription().toString() : "error";
                        appendError("WebView: " + desc);
                    }
                }
            });

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                    if (consoleMessage == null) return true;
                    ConsoleMessage.MessageLevel level = consoleMessage.messageLevel();
                    if (level == ConsoleMessage.MessageLevel.ERROR
                        || level == ConsoleMessage.MessageLevel.WARNING) {
                        appendError("JS " + level + ": " + consoleMessage.message()
                            + "\n  " + consoleMessage.sourceId()
                            + ":" + consoleMessage.lineNumber());
                    }
                    return true;
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

            webView.loadUrl("file:///android_asset/index.html");
        } catch (Exception error) {
            TextView crashView = new TextView(this);
            crashView.setTextColor(Color.WHITE);
            crashView.setBackgroundColor(Color.RED);
            crashView.setPadding(16, 16, 16, 16);
            crashView.setText("Краш Android при запуске:\n" + error.toString());
            setContentView(crashView);
        }
    }

    private void appendError(String line) {
        if (errorLogView == null) return;
        errorLogView.append(line);
        if (!line.endsWith("\n")) {
            errorLogView.append("\n");
        }
        if (errorScrollView != null) {
            errorScrollView.setVisibility(View.VISIBLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterFullscreenMode();
        }
    }

    private void enterFullscreenMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams layoutParams = getWindow().getAttributes();
            layoutParams.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(layoutParams);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }

        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN;

        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
