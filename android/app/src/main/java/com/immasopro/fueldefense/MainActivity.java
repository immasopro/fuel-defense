package com.immasopro.fueldefense;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Portrait WebView host with density-aware defaults.
 * Canvas/HUD DPI scaling is handled in JS (devicePixelRatio + --ui-scale).
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        // Keep CSS pixels = density-independent; JS reads window.devicePixelRatio.
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        webView.setInitialScale(0);
    }
}
