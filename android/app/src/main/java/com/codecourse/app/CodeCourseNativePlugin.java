package com.codecourse.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CodeCourseNative")
public class CodeCourseNativePlugin extends Plugin {
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
    public void notifyCompletion(PluginCall call) {
        String label = call.getString("label", "学习内容已经生成完成");
        CodeCourseGenerationService.showCompletion(getContext(), label);
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
}
