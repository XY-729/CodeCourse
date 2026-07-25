package com.codecourse.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "CodeCourseNative")
public class CodeCourseNativePlugin extends Plugin {

    private static final String TAG = "CCNativePlugin";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 3001;
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
            // Stop foreground before stopping service
            getContext().stopService(new Intent(getContext(), CodeCourseGenerationService.class));
        }
        call.resolve();
    }

    @PluginMethod
    public void updateGenerationProgress(PluginCall call) {
        long sessionId = call.getInt("sessionId", 0);
        int taskId = call.getInt("taskId", 0);
        int sequence = call.getInt("sequence", 0);
        int current = call.getInt("current", 0);
        int total = call.getInt("total", 0);
        boolean indeterminate = Boolean.TRUE.equals(call.getBoolean("indeterminate", total <= 0));
        String stageLabel = call.getString("stageLabel", "");
        int activeTaskCount = call.getInt("activeTaskCount", 1);

        CodeCourseGenerationService.updateProgress(
            getContext(), sessionId, taskId, sequence,
            current, total, indeterminate, stageLabel, activeTaskCount);
        call.resolve();
    }

    @PluginMethod
    public void switchForegroundTask(PluginCall call) {
        long sessionId = call.getInt("sessionId", 0);
        int taskId = call.getInt("taskId", 0);
        CodeCourseGenerationService.switchForegroundTask(sessionId, taskId);
        call.resolve();
    }

    @PluginMethod
    public void notifyCompletion(PluginCall call) {
        int taskId = call.getInt("taskId", 0);
        String label = call.getString("label", "学习内容已经生成完成");
        CodeCourseGenerationService.showCompletion(getContext(), taskId, label);
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
     * Returns a detailed permission status object.
     * Android 12-: {granted:true, status:"not_required", canAskAgain:false}
     * Android 13+: checks runtime permission + system notification toggle
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermissionStatus(call, true, "not_required", false);
            return;
        }

        Context context = getContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            resolvePermissionStatus(call, false, "error", false);
            return;
        }

        boolean runtimeGranted = ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
        boolean notificationsEnabled = manager.areNotificationsEnabled();

        if (runtimeGranted && notificationsEnabled) {
            resolvePermissionStatus(call, true, "granted", false);
            return;
        }

        if (!runtimeGranted && getActivity() != null) {
            boolean canAsk = ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.POST_NOTIFICATIONS)
                || true; // First denial still allows re-asking

            // If user previously denied permanently (don't ask again), canAskAgain=false
            boolean deniedPermanently = !canAsk
                && !ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.POST_NOTIFICATIONS);

            // Store call for async result
            pendingPermissionCall = call;
            String[] permissions = { Manifest.permission.POST_NOTIFICATIONS };
            bridge.saveCall(call);
            ActivityCompat.requestPermissions(getActivity(), permissions, NOTIFICATION_PERMISSION_REQUEST);
            // Result delivered via handleRequestPermissionsResult
            return;
        }

        if (!notificationsEnabled && runtimeGranted) {
            resolvePermissionStatus(call, false, "notifications_disabled", true);
            return;
        }

        // Runtime not granted and no activity to request
        boolean canAsk = getActivity() == null
            ? false
            : ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.POST_NOTIFICATIONS);
        resolvePermissionStatus(call, false,
            canAsk ? "denied" : "denied_permanently",
            canAsk);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Unable to open notification settings", e);
        }
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Context context = getContext();
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            boolean notificationsEnabled = manager != null && manager.areNotificationsEnabled();

            PluginCall savedCall = pendingPermissionCall != null
                ? bridge.getSavedCall(pendingPermissionCall.getCallbackId())
                : null;
            pendingPermissionCall = null;

            if (savedCall != null) {
                if (granted && notificationsEnabled) {
                    resolvePermissionStatus(savedCall, true, "granted", false);
                } else if (!granted && getActivity() != null) {
                    boolean canAsk = ActivityCompat.shouldShowRequestPermissionRationale(
                        getActivity(), Manifest.permission.POST_NOTIFICATIONS);
                    resolvePermissionStatus(savedCall, false,
                        canAsk ? "denied" : "denied_permanently", canAsk);
                } else {
                    resolvePermissionStatus(savedCall, false, "denied_permanently", false);
                }
            }
        }
    }

    private void resolvePermissionStatus(PluginCall call, boolean granted, String status, boolean canAskAgain) {
        try {
            JSONObject result = new JSONObject();
            result.put("granted", granted);
            result.put("status", status);
            result.put("canAskAgain", canAskAgain);
            call.resolve(JSObject.fromJSONObject(result));
        } catch (Exception e) {
            call.resolve();
        }
    }
}
