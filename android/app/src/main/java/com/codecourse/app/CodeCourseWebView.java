package com.codecourse.app;

import android.content.Context;
import android.graphics.Rect;
import android.util.AttributeSet;
import android.util.Log;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;

import com.getcapacitor.CapacitorWebView;

public class CodeCourseWebView extends CapacitorWebView {

    private static final int ASK_SELECTION_MENU_ID = 0xCC01;
    private static final String TAG = "CCSelection";

    public CodeCourseWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        Log.d(TAG, "WebView.startActionMode primary");
        return super.startActionMode(wrap(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        Log.d(TAG, "WebView.startActionMode type=" + type);
        return super.startActionMode(wrap(callback), type);
    }

    private ActionMode.Callback wrap(ActionMode.Callback callback) {
        if (callback instanceof SelectionActionModeCallback) {
            return callback;
        }
        return new SelectionActionModeCallback(callback);
    }

    // ---- inner callback wrapper ----

    private final class SelectionActionModeCallback extends ActionMode.Callback2 {

        private final ActionMode.Callback delegate;

        SelectionActionModeCallback(ActionMode.Callback delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean created = delegate.onCreateActionMode(mode, menu);
            Log.d(TAG, "onCreateActionMode created=" + created);
            if (created) {
                ensureAskMenuItem(menu);
            }
            return created;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            // Delegate first — WebView may clear or regenerate the menu.
            boolean delegateChanged = delegate.onPrepareActionMode(mode, menu);
            boolean askChanged = ensureAskMenuItem(menu);
            Log.d(TAG, "onPrepareActionMode askPresent=" + (menu.findItem(ASK_SELECTION_MENU_ID) != null));
            return delegateChanged || askChanged;
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

    // ---- helper methods ----

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
        evaluateJavascript(script, result -> {
            if ("true".equals(result)) {
                mode.finish();
            }
        });
        return true;
    }
}
