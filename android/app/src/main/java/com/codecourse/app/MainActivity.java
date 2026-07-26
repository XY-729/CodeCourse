package com.codecourse.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.view.ActionMode;
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
        savePendingNavigationFromIntent(intent);

        // Emit to WebView via bridge event for warm start
        emitCompletionNavigation(intent);
    }

    private void savePendingNavigationFromIntent(Intent intent) {
        if (intent == null) return;
        int projectId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_PROJECT_ID, 0);
        int taskId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_COMPLETION_TASK_ID, 0);
        if (projectId <= 0 && taskId <= 0) return;

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
        } catch (Exception e) {
            Log.w(TAG, "Failed to save pending navigation: " + e.getMessage());
        }
    }

    private void emitCompletionNavigation(Intent intent) {
        if (intent == null) return;
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

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
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
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.statusBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
