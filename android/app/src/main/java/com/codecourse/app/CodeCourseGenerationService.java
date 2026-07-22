package com.codecourse.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/** Keeps the WebView process available while a user-approved generation task is running. */
public class CodeCourseGenerationService extends Service {
    private static final String CHANNEL_ID = "codecourse_generation";
    private static final String EXTRA_LABEL = "label";
    private static final int NOTIFICATION_ID = 2107;
    private static final long MAX_WAKE_TIME_MS = 2L * 60L * 60L * 1000L;
    private PowerManager.WakeLock wakeLock;

    public static Intent createStartIntent(Context context, String label) {
        return new Intent(context, CodeCourseGenerationService.class)
            .putExtra(EXTRA_LABEL, label);
    }

    public static void showCompletion(Context context, String label) {
        createNotificationChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID + 1, createNotification(context, label, false));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel(this);
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CodeCourse:Generation");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String label = intent == null ? null : intent.getStringExtra(EXTRA_LABEL);
        if (label == null || label.trim().isEmpty()) label = "正在后台生成学习内容";
        startForeground(NOTIFICATION_ID, createNotification(this, label, true));
        if (!wakeLock.isHeld()) wakeLock.acquire(MAX_WAKE_TIME_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // A swipe-away destroys the WebView that performs the request. Stop the
        // notification; the persisted checkpoint resumes on the next launch.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static Notification createNotification(Context context, String label, boolean ongoing) {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, pendingFlags);
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_codecourse)
            .setContentTitle("CodeCourse")
            .setContentText(label)
            .setContentIntent(pendingIntent)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setCategory(ongoing ? NotificationCompat.CATEGORY_PROGRESS : NotificationCompat.CATEGORY_STATUS)
            .setPriority(ongoing ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(!ongoing)
            .build();
    }

    private static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "课程生成",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("在后台继续生成 CodeCourse 学习内容");
        channel.setShowBadge(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }
}
