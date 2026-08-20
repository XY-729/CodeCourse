package com.codecourse.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "CodeCourseNative")
public class CodeCourseNativePlugin extends Plugin {

    private static final int NOTIFICATION_PERMISSION_REQUEST = 3001;
    private static final String PREFS_NAME = "codecourse_prefs";
    private static final String PREF_PERMISSION_REQUESTED = "notification_permission_requested_before";

    private PluginCall pendingPermissionCall;

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only HTTP(S) URLs are allowed"); return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (Exception e) { call.reject("Unable to open external URL", e); }
    }

    @PluginMethod
    public void notifyCompletion(PluginCall call) {
        CodeCourseNotifications.showCompletion(
            getContext(),
            call.getInt("taskId", 0),
            call.getInt("projectId", 0),
            call.getString("taskType", ""),
            call.getString("outputPath", ""),
            call.getString("label", "学习内容已经生成完成"));
        call.resolve();
    }

    @PluginMethod
    public void moveToBackground(PluginCall call) {
        if (getActivity() == null) { call.reject("Activity unavailable"); return; }
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermissionStatus(call, true, "not_required", false);
            return;
        }
        Context ctx = getContext();
        NotificationManager mgr = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) { resolvePermissionStatus(call, false, "error", false); return; }

        boolean runtimeGranted = ActivityCompat.checkSelfPermission(ctx,
            Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean notifEnabled = mgr.areNotificationsEnabled();

        if (runtimeGranted && notifEnabled) {
            resolvePermissionStatus(call, true, "granted", false);
            return;
        }

        // notifications disabled in system but runtime OK
        if (runtimeGranted && !notifEnabled) {
            resolvePermissionStatus(call, false, "notifications_disabled", false);
            return;
        }

        // runtime not granted
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean requestedBefore = prefs.getBoolean(PREF_PERMISSION_REQUESTED, false);

        if (getActivity() == null) {
            resolvePermissionStatus(call, false, "no_activity", true);
            return;
        }

        if (!requestedBefore) {
            // First request
            prefs.edit().putBoolean(PREF_PERMISSION_REQUESTED, true).apply();
            pendingPermissionCall = call;
            bridge.saveCall(call);
            ActivityCompat.requestPermissions(getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST);
            return;
        }

        // Already requested before — check repeatability
        boolean canAsk = ActivityCompat.shouldShowRequestPermissionRationale(
            getActivity(), Manifest.permission.POST_NOTIFICATIONS);
        resolvePermissionStatus(call, false,
            canAsk ? "denied" : "denied_permanently", canAsk);
    }

    @PluginMethod
    public void getNotificationPermissionStatus(PluginCall call) {
        resolveCurrentPermissionStatus(call);
    }

    @PluginMethod
    public void consumePendingCompletionNavigation(PluginCall call) {
        try {
            String pending = MainActivity.consumePendingNavigation(getContext());
            if (pending != null && !pending.isEmpty()) {
                JSObject result = new JSObject(pending);
                call.resolve(result);
            } else {
                call.resolve();
            }
        } catch (Exception e) {
            call.resolve();
        }
    }

    @PluginMethod
    public void ackCompletionNavigation(PluginCall call) {
        MainActivity.ackPendingNavigation(getContext(), call.getString("navigationId", ""));
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            if (getActivity() != null) getActivity().startActivity(intent);
            else { intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(intent); }
            call.resolve();
        } catch (Exception e) { call.reject("Cannot open notification settings", e); }
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return;

        boolean granted = grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        Context ctx = getContext();
        NotificationManager mgr = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean notifEnabled = mgr != null && mgr.areNotificationsEnabled();

        PluginCall saved = pendingPermissionCall != null
            ? bridge.getSavedCall(pendingPermissionCall.getCallbackId()) : null;
        pendingPermissionCall = null;

        if (saved != null) {
            if (granted && notifEnabled) {
                resolvePermissionStatus(saved, true, "granted", false);
            } else if (granted && !notifEnabled) {
                resolvePermissionStatus(saved, false, "notifications_disabled", false);
            } else if (getActivity() != null) {
                boolean canAsk = ActivityCompat.shouldShowRequestPermissionRationale(
                    getActivity(), Manifest.permission.POST_NOTIFICATIONS);
                resolvePermissionStatus(saved, false,
                    canAsk ? "denied" : "denied_permanently", canAsk);
            } else {
                resolvePermissionStatus(saved, false, "denied_permanently", false);
            }
        }
    }

    private void resolvePermissionStatus(PluginCall call, boolean granted, String status, boolean canAskAgain) {
        try {
            JSONObject r = new JSONObject();
            r.put("granted", granted);
            r.put("status", status);
            r.put("canAskAgain", canAskAgain);
            call.resolve(JSObject.fromJSONObject(r));
        } catch (Exception e) { call.resolve(); }
    }

    private void resolveCurrentPermissionStatus(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermissionStatus(call, true, "not_required", false);
            return;
        }
        Context ctx = getContext();
        NotificationManager mgr = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) {
            resolvePermissionStatus(call, false, "error", false);
            return;
        }
        boolean runtimeGranted = ActivityCompat.checkSelfPermission(
            ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean notificationsEnabled = mgr.areNotificationsEnabled();
        if (runtimeGranted && notificationsEnabled) {
            resolvePermissionStatus(call, true, "granted", false);
            return;
        }
        if (runtimeGranted) {
            resolvePermissionStatus(call, false, "notifications_disabled", false);
            return;
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean requestedBefore = prefs.getBoolean(PREF_PERMISSION_REQUESTED, false);
        if (!requestedBefore) {
            resolvePermissionStatus(call, false, "denied", true);
            return;
        }
        boolean canAskAgain = requestedBefore && getActivity() != null
            && ActivityCompat.shouldShowRequestPermissionRationale(
                getActivity(), Manifest.permission.POST_NOTIFICATIONS);
        resolvePermissionStatus(call, false,
            canAskAgain ? "denied" : "denied_permanently", canAskAgain);
    }
}
