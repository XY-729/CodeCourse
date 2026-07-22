package com.codecourse.app;

import android.os.Bundle;
import android.util.Log;
import android.view.ActionMode;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
