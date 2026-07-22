package com.codecourse.app;

import android.graphics.Rect;
import android.os.Bundle;
import android.util.Log;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
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

    // ---- ActionMode callback wrapping ----

    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback, int type) {
        if (!(callback instanceof SelectionActionModeCallback)) {
            callback = new SelectionActionModeCallback(callback);
        }
        return super.onWindowStartingActionMode(callback, type);
    }

    private final class SelectionActionModeCallback extends ActionMode.Callback2 {

        private final ActionMode.Callback delegate;

        SelectionActionModeCallback(ActionMode.Callback delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean created = delegate.onCreateActionMode(mode, menu);
            if (created) {
                ensureAskMenuItem(menu);
            }
            return created;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            // Delegate first — WebView may clear or regenerate the menu.
            boolean delegateChanged = delegate.onPrepareActionMode(mode, menu);
            // Re-add "提问" after WebView has finished refreshing.
            boolean askItemChanged = ensureAskMenuItem(menu);
            return delegateChanged || askItemChanged;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            if (item.getItemId() == ASK_SELECTION_MENU_ID) {
                return handleAskSelection(mode);
            }
            return delegate.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            delegate.onDestroyActionMode(mode);
        }

        @Override
        public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
            if (delegate instanceof ActionMode.Callback2) {
                ((ActionMode.Callback2) delegate).onGetContentRect(mode, view, outRect);
            } else {
                super.onGetContentRect(mode, view, outRect);
            }
        }
    }

    private boolean ensureAskMenuItem(Menu menu) {
        MenuItem askItem = menu.findItem(ASK_SELECTION_MENU_ID);
        boolean added = false;
        if (askItem == null) {
            askItem = menu.add(Menu.NONE, ASK_SELECTION_MENU_ID, 0, "提问");
            added = true;
        }
        askItem.setVisible(true);
        askItem.setEnabled(true);
        askItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        return added;
    }

    private boolean handleAskSelection(ActionMode mode) {
        if (getBridge() == null) {
            return false;
        }
        WebView webView = getBridge().getWebView();
        String script = "(function(){"
                + "var s=window.getSelection?window.getSelection():null;"
                + "var t=String(s||'').trim();"
                + "if(!t){return false;}"
                + "window.dispatchEvent(new CustomEvent("
                + "'codecourse-native-selection-ask',"
                + "{detail:{text:t}}"
                + "));"
                + "return true;"
                + "})();";
        webView.evaluateJavascript(script, result -> {
            if ("true".equals(result)) {
                mode.finish();
            }
        });
        return true;
    }

    // ---- Logging only (menu managed by SelectionActionModeCallback) ----

    @Override
    public void onActionModeStarted(ActionMode mode) {
        Log.d(SELECTION_TAG, "ActionMode started, type=" + mode.getType());
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
