package com.codecourse.app;

import android.content.Intent;
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

    private Intent pendingCompletionIntent = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CodeCourseSecureStorePlugin.class);
        registerPlugin(CodeCourseNativePlugin.class);
        super.onCreate(savedInstanceState);
        applyFullscreen();

        // Handle initial launch from notification click
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        int projectId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_PROJECT_ID, 0);
        int taskId = intent.getIntExtra(CodeCourseGenerationService.EXTRA_COMPLETION_TASK_ID, 0);
        String taskType = intent.getStringExtra(CodeCourseGenerationService.EXTRA_TASK_TYPE);
        String outputPath = intent.getStringExtra(CodeCourseGenerationService.EXTRA_OUTPUT_PATH);

        if (projectId <= 0 && taskId <= 0) return; // Not a completion notification

        Log.d(TAG, "Completion navigation: projectId=" + projectId
            + " taskId=" + taskId + " outputPath=" + outputPath);

        pendingCompletionIntent = intent;

        // Emit to WebView via bridge event
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
