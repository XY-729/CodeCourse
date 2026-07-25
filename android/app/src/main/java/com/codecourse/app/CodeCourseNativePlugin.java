package com.codecourse.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "CodeCourseNative")
public class CodeCourseNativePlugin extends Plugin {

    private static final String TAG = "CCNativePlugin";

    // Held across permission request lifecycle
    private PluginCall pendingPermissionCall;

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only HTTP(S) URLs are allowed");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open external URL", error);
        }
    }

    @PluginMethod
    public void setGenerationActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        if (active) {
            String label = call.getString("label", "正在后台生成学习内容");
            Intent intent = CodeCourseGenerationService.createStartIntent(getContext(), label);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } else {
            getContext().stopService(new Intent(getContext(), CodeCourseGenerationService.class));
        }
        call.resolve();
    }

    @PluginMethod
    public void updateGenerationProgress(PluginCall call) {
        int current = call.getInt("current", 0);
        int total = call.getInt("total", 0);
        boolean indeterminate = Boolean.TRUE.equals(call.getBoolean("indeterminate", total <= 0));
        String stageLabel = call.getString("stageLabel", "");
        CodeCourseGenerationService.updateProgress(getContext(), current, total, indeterminate, stageLabel);
        call.resolve();
    }

    @PluginMethod
    public void notifyCompletion(PluginCall call) {
        String label = call.getString("label", "学习内容已经生成完成");
        String courseName = call.getString("courseName", "");
        CodeCourseGenerationService.showCompletion(getContext(), label, courseName);
        call.resolve();
    }

    @PluginMethod
    public void moveToBackground(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity is unavailable");
            return;
        }
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    /**
     * Check notification permission status. If not granted on Android 13+,
     * request it from the user. On Android 12 and below, always returns granted=true.
     *
     * Returns: { granted: boolean, reason?: string }
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermissionResult(call, true, "pre_tiramisu");
            return;
        }

        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && manager.areNotificationsEnabled()) {
            resolvePermissionResult(call, true, "already_enabled");
            return;
        }

        // Check if we should show rationale
        if (getActivity() != null && ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.POST_NOTIFICATIONS)) {
            // User previously denied but hasn't selected "don't ask again".
            // We'll request again — but only once per session.
        }

        // Request the permission
        if (getActivity() != null) {
            pendingPermissionCall = call;
            // Use the bridge to request; the result comes back via handleRequestPermissionsResult
            String[] permissions = { Manifest.permission.POST_NOTIFICATIONS };
            bridge.saveCall(call);
            ActivityCompat.requestPermissions(getActivity(), permissions, 3001);
        } else {
            resolvePermissionResult(call, false, "no_activity");
        }
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == 3001) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            PluginCall savedCall = bridge.getSavedCall(pendingPermissionCall != null ? pendingPermissionCall.getCallbackId() : null);
            if (savedCall != null) {
                resolvePermissionResult(savedCall, granted, granted ? "granted" : "denied");
            }
            pendingPermissionCall = null;
        }
    }

    private void resolvePermissionResult(PluginCall call, boolean granted, String reason) {
        try {
            JSONObject result = new JSONObject();
            result.put("granted", granted);
            result.put("reason", reason);
            call.resolve(JSObject.fromJSONObject(result));
        } catch (Exception e) {
            call.resolve();
        }
    }
}
