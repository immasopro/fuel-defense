package com.immasopro.fueldefense;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Immersive fullscreen game host (status + nav bars hidden, sticky).
 * Canvas/HUD DPI scaling is handled in JS (devicePixelRatio + --ui-scale).
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveFullscreen();
        configureWebView();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveFullscreen();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersiveFullscreen();
    }

    private void applyImmersiveFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decor = getWindow().getDecorView();
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decor);
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }

    private void configureWebView() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        webView.setInitialScale(0);
    }
}
