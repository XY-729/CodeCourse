package com.codecourse.app;

import android.os.Bundle;
import android.util.Log;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int ASK_SELECTION_MENU_ID = 0xCC01;
    private static final String SELECTION_TAG = "CCSelection";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CodeCourseSecureStorePlugin.class);
        registerPlugin(CodeCourseNativePlugin.class);
        super.onCreate(savedInstanceState);
        applyFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyFullscreen();
        }
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        Log.d(SELECTION_TAG, "ActionMode started, type=" + mode.getType());
        // Add "提问" before super so it occupies the primary action slot.
        // WebView's Copy/SelectAll are added by super and get secondary slots.
        Menu menu = mode.getMenu();
        if (menu.findItem(ASK_SELECTION_MENU_ID) == null) {
            MenuItem askItem = menu.add(Menu.NONE, ASK_SELECTION_MENU_ID, 0, "提问");
            askItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
            askItem.setOnMenuItemClickListener(item -> {
            if (getBridge() == null) {
                return false;
            }
            WebView webView = getBridge().getWebView();
            String script = "(function(){"
                    + "var text=String(window.getSelection ? window.getSelection() : '').trim();"
                    + "if(!text){return false;}"
                    + "window.dispatchEvent(new CustomEvent('codecourse-native-selection-ask',{detail:{text:text}}));"
                    + "return true;"
                    + "})();";
                webView.evaluateJavascript(script, ignored -> mode.finish());
                return true;
            });
        }
        super.onActionModeStarted(mode);
    }

    @Override
    public void onActionModeFinished(ActionMode mode) {
        Log.d(SELECTION_TAG, "ActionMode finished, type=" + mode.getType());
        super.onActionModeFinished(mode);
    }

    private void applyFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
