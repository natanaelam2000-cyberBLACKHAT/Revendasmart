package com.revendasmart.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.facebook.FacebookSdk;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthConfigurationPlugin.class);
        // Auto-init is disabled so an unconfigured Facebook provider cannot crash app startup.
        String facebookAppId = getString(R.string.facebook_app_id);
        String facebookClientToken = getString(R.string.facebook_client_token);
        if (!facebookAppId.isEmpty() && !facebookClientToken.isEmpty()) {
            FacebookSdk.setApplicationId(facebookAppId);
            FacebookSdk.setClientToken(facebookClientToken);
            FacebookSdk.sdkInitialize(getApplicationContext());
        }
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
    }
}
