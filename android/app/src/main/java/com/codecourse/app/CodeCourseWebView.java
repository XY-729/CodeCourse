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
    private static final int EXPLAIN_TERM_MENU_ID = 0xCC02;
    private static final int MARK_KNOWN_MENU_ID = 0xCC03;
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
        private boolean knownActionVisible = false;
        private boolean knownVisibilityProbePending = false;
        private boolean destroyed = false;

        SelectionActionModeCallback(ActionMode.Callback delegate) {
            this.delegate = delegate;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean created = delegate.onCreateActionMode(mode, menu);
            Log.d(TAG, "onCreateActionMode created=" + created);
            if (created) {
                sanitizeSelectionMenu(menu, knownActionVisible);
                refreshKnownActionVisibility(mode);
            }
            return created;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            // Delegate first — WebView may clear or regenerate the menu.
            boolean delegateChanged = delegate.onPrepareActionMode(mode, menu);
            boolean menuChanged = sanitizeSelectionMenu(menu, knownActionVisible);
            refreshKnownActionVisibility(mode);
            Log.d(TAG, "onPrepareActionMode askPresent=" + (menu.findItem(ASK_SELECTION_MENU_ID) != null));
            return delegateChanged || menuChanged;
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            if (item.getItemId() == ASK_SELECTION_MENU_ID) {
                return handleSelectionAction(mode, "codecourse-native-selection-ask");
            }
            if (item.getItemId() == EXPLAIN_TERM_MENU_ID) {
                return handleSelectionAction(mode, "codecourse-native-selection-explain");
            }
            if (item.getItemId() == MARK_KNOWN_MENU_ID) {
                return handleSelectionAction(mode, "codecourse-native-selection-known");
            }
            return delegate.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            destroyed = true;
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

        private void refreshKnownActionVisibility(ActionMode mode) {
            if (destroyed || knownVisibilityProbePending) {
                return;
            }
            knownVisibilityProbePending = true;
            String script = "(function(){"
                    + "var s=window.getSelection?window.getSelection():null;"
                    + "if(!s||s.rangeCount===0||s.isCollapsed){return false;}"
                    + "function el(n){return n&&n.nodeType===1?n:(n&&n.parentElement?n.parentElement:null);}"
                    + "function unfamiliar(n){var e=el(n);return !!(e&&e.closest&&e.closest('[data-codecourse-unfamiliar-term=\"true\"]'));}"
                    + "var r=s.getRangeAt(0);"
                    + "return unfamiliar(s.anchorNode)||unfamiliar(s.focusNode)||unfamiliar(r.commonAncestorContainer);"
                    + "})();";
            evaluateJavascript(script, result -> {
                knownVisibilityProbePending = false;
                if (destroyed) {
                    return;
                }
                boolean shouldShow = "true".equals(result);
                if (knownActionVisible != shouldShow) {
                    knownActionVisible = shouldShow;
                    mode.invalidate();
                }
            });
        }
    }

    // ---- helper methods ----

    private boolean sanitizeSelectionMenu(Menu menu, boolean showKnownAction) {
        boolean changed = removeShareMenuItems(menu);
        MenuItem askItem = menu.findItem(ASK_SELECTION_MENU_ID);
        if (askItem == null) {
            askItem = menu.add(Menu.NONE, ASK_SELECTION_MENU_ID, 0, "提问");
            changed = true;
        }
        askItem.setVisible(true);
        askItem.setEnabled(true);
        askItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);

        MenuItem explainItem = menu.findItem(EXPLAIN_TERM_MENU_ID);
        if (explainItem == null) {
            explainItem = menu.add(Menu.NONE, EXPLAIN_TERM_MENU_ID, 1, "解释术语");
            changed = true;
        }
        explainItem.setVisible(true);
        explainItem.setEnabled(true);
        explainItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);

        MenuItem knownItem = menu.findItem(MARK_KNOWN_MENU_ID);
        if (knownItem == null) {
            knownItem = menu.add(Menu.NONE, MARK_KNOWN_MENU_ID, 2, "我认识");
            changed = true;
        }
        if (knownItem.isVisible() != showKnownAction || knownItem.isEnabled() != showKnownAction) {
            changed = true;
        }
        knownItem.setVisible(showKnownAction);
        knownItem.setEnabled(showKnownAction);
        knownItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);
        return changed;
    }

    private boolean removeShareMenuItems(Menu menu) {
        boolean changed = menu.findItem(android.R.id.shareText) != null;
        menu.removeItem(android.R.id.shareText);
        for (int index = menu.size() - 1; index >= 0; index--) {
            MenuItem item = menu.getItem(index);
            CharSequence title = item.getTitle();
            String normalizedTitle = title == null ? "" : title.toString().trim();
            if ("分享".equals(normalizedTitle) || "Share".equalsIgnoreCase(normalizedTitle)) {
                menu.removeItem(item.getItemId());
                changed = true;
            }
        }
        return changed;
    }

    private boolean handleSelectionAction(ActionMode mode, String eventName) {
        String script = "(function(){"
                + "var s=window.getSelection?window.getSelection():null;"
                + "var t=String(s||'').trim();"
                + "if(!t){return false;}"
                + "window.dispatchEvent(new CustomEvent("
                + "'" + eventName + "',"
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
