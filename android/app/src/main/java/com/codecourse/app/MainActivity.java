package com.codecourse.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ActionMode;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.JSObject;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "CCMainActivity";
    private static final String SELECTION_TAG = "CCSelection";

    private static final String PENDING_NAV_PREF = "codecourse_pending_nav";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CodeCourseSecureStorePlugin.class);
        registerPlugin(CodeCourseNativePlugin.class);
        super.onCreate(savedInstanceState);
        applyFullscreen();

        // Save completion intent extras to SharedPreferences for cold-start consume.
        // The event path handles warm start; the pref path handles cold start.
        Intent intent = getIntent();
        if (intent != null) {
            savePendingNavigationFromIntent(intent);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String navigationId = savePendingNavigationFromIntent(intent);

        // Emit to WebView via bridge event for warm start
        emitCompletionNavigation(intent, navigationId);
    }

    private String savePendingNavigationFromIntent(Intent intent) {
        if (intent == null) return null;
        int projectId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_PROJECT_ID, 0);
        int taskId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_COMPLETION_TASK_ID, 0);
        if (projectId <= 0 && taskId <= 0) return null;

        String taskType = intent.getStringExtra(CodeCourseGenerationService.EXTRA_TASK_TYPE);
        String outputPath = intent.getStringExtra(CodeCourseGenerationService.EXTRA_OUTPUT_PATH);
        String navigationId = String.valueOf(System.currentTimeMillis()) + "_" + taskId;

        try {
            JSONObject payload = new JSONObject();
            payload.put("projectId", projectId);
            payload.put("taskId", taskId);
            payload.put("taskType", taskType != null ? taskType : "");
            payload.put("outputPath", outputPath != null ? outputPath : "");
            payload.put("navigationId", navigationId);

            getSharedPreferences(PENDING_NAV_PREF, MODE_PRIVATE)
                .edit().putString("pending", payload.toString()).apply();

            Log.d(TAG, "Saved pending navigation: projectId=" + projectId
                + " taskId=" + taskId + " navId=" + navigationId);
            return navigationId;
        } catch (Exception e) {
            Log.w(TAG, "Failed to save pending navigation: " + e.getMessage());
            return null;
        }
    }

    private void emitCompletionNavigation(Intent intent, String navigationId) {
        if (intent == null || navigationId == null || navigationId.isEmpty()) return;
        int projectId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_PROJECT_ID, 0);
        int taskId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_COMPLETION_TASK_ID, 0);
        if (projectId <= 0 && taskId <= 0) return;

        String taskType = intent.getStringExtra(CodeCourseGenerationService.EXTRA_TASK_TYPE);
        String outputPath = intent.getStringExtra(CodeCourseGenerationService.EXTRA_OUTPUT_PATH);

        try {
            JSONObject payload = new JSONObject();
            payload.put("projectId", projectId);
            payload.put("taskId", taskId);
            payload.put("taskType", taskType != null ? taskType : "");
            payload.put("outputPath", outputPath != null ? outputPath : "");
            payload.put("navigationId", navigationId);

            JSObject eventData = JSObject.fromJSONObject(payload);
            bridge.triggerWindowJSEvent("codecourseCompletionNavigation", eventData.toString());
        } catch (Exception e) {
            Log.w(TAG, "Failed to emit completion navigation event: " + e.getMessage());
        }
    }

    /** Called by CodeCourseNativePlugin to consume the pending cold-start navigation. */
    static String consumePendingNavigation(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PENDING_NAV_PREF, Context.MODE_PRIVATE);
        String pending = prefs.getString("pending", null);
        if (pending != null) {
            prefs.edit().remove("pending").apply();
        }
        return pending;
    }

    /** Remove a warm-start pending navigation only when the acknowledgement matches it. */
    static boolean ackPendingNavigation(Context ctx, String navigationId) {
        if (navigationId == null || navigationId.isEmpty()) return false;
        SharedPreferences prefs = ctx.getSharedPreferences(PENDING_NAV_PREF, Context.MODE_PRIVATE);
        String pending = prefs.getString("pending", null);
        if (pending == null) return false;
        try {
            JSONObject payload = new JSONObject(pending);
            if (!navigationId.equals(payload.optString("navigationId", ""))) return false;
            prefs.edit().remove("pending").apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyFullscreen();
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
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            window, window.getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
