package com.codecourse.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/** Completion-only notifications. Generation itself remains foreground WebView work. */
final class CodeCourseNotifications {
    private static final String CHANNEL_COMPLETION = "codecourse_generation_completion";
    private static final String RETIRED_CHANNEL_PROGRESS = "codecourse_generation_progress";

    private CodeCourseNotifications() {}

    static void showCompletion(
        Context context,
        int taskId,
        int projectId,
        String taskType,
        String outputPath,
        String bodyText
    ) {
        ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Bundle extras = new Bundle();
        extras.putInt(CompletionNotificationContract.EXTRA_PROJECT_ID, projectId);
        extras.putInt(CompletionNotificationContract.EXTRA_COMPLETION_TASK_ID, taskId);
        extras.putString(CompletionNotificationContract.EXTRA_TASK_TYPE, taskType == null ? "" : taskType);
        extras.putString(CompletionNotificationContract.EXTRA_OUTPUT_PATH, outputPath == null ? "" : outputPath);

        try {
            manager.notify(
                CompletionNotificationContract.notificationId(taskId),
                new NotificationCompat.Builder(context, CHANNEL_COMPLETION)
                    .setSmallIcon(R.drawable.ic_stat_codecourse)
                    .setContentTitle("生成完成")
                    .setContentText(CompletionNotificationContract.normalizeBody(bodyText))
                    .setContentIntent(createLaunchIntent(context, taskId, extras))
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(false)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
            );
        } catch (SecurityException ignored) {
            // Android 13+ may deny notification permission. Completion is already persisted.
        }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (manager.getNotificationChannel(RETIRED_CHANNEL_PROGRESS) != null) {
            manager.deleteNotificationChannel(RETIRED_CHANNEL_PROGRESS);
        }
        if (manager.getNotificationChannel(CHANNEL_COMPLETION) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_COMPLETION,
            "生成结果",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("应用在前台完成内容生成后的提醒");
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent createLaunchIntent(Context context, int requestCode, @Nullable Bundle extras) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (extras != null) intent.putExtras(extras);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }
}
