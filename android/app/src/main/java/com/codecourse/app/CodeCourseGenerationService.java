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
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;

/**
 * Foreground Service that raises process priority during user-approved
 * generation tasks, with a time-limited PARTIAL_WAKE_LOCK to reduce the
 * chance of CPU-sleep interruption during background generation.
 */
public class CodeCourseGenerationService extends Service {
    private static final String TAG = "CCGenService";
    private static final String CHANNEL_ID = "codecourse_generation";
    private static final String EXTRA_LABEL = "label";
    private static final int NOTIFICATION_ID = 2107;
    private static final int COMPLETION_BASE_ID = 2200;
    private static final long MAX_WAKE_TIME_MS = 2L * 60L * 60L * 1000L;

    private PowerManager.WakeLock wakeLock;

    // ---- progress state (thread-safe) ----
    private static final Object PROGRESS_LOCK = new Object();
    private static int sProgressCurrent;
    private static int sProgressTotal;
    private static boolean sProgressIndeterminate = true;
    private static String sStageLabel = "";

    // ---- public helpers ----

    public static Intent createStartIntent(Context context, String label) {
        return new Intent(context, CodeCourseGenerationService.class)
            .putExtra(EXTRA_LABEL, label);
    }

    /**
     * Update the foreground notification with real progress.
     * Safe to call even when the Service is not running — a no-op in that case.
     */
    public static void updateProgress(Context context, int current, int total, boolean indeterminate, String stageLabel) {
        // Validate inputs
        int safeCurrent = Math.max(0, current);
        int safeTotal = total;
        if (safeTotal <= 0) {
            safeTotal = 0;
            indeterminate = true;
        } else if (safeCurrent > safeTotal) {
            safeCurrent = safeTotal;
        }
        String safeLabel = (stageLabel == null || stageLabel.trim().isEmpty()) ? "" : stageLabel.trim();

        synchronized (PROGRESS_LOCK) {
            sProgressCurrent = safeCurrent;
            sProgressTotal = safeTotal;
            sProgressIndeterminate = indeterminate;
            sStageLabel = safeLabel;
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        try {
            manager.notify(NOTIFICATION_ID, buildProgressNotification(context, safeCurrent, safeTotal, indeterminate, safeLabel));
        } catch (SecurityException e) {
            Log.w(TAG, "Cannot update notification — permission denied");
        }
    }

    /**
     * Send a one-shot completion notification.
     * Safe to call even without notification permission — logs and returns silently.
     */
    public static void showCompletion(Context context, String label, String courseName) {
        createNotificationChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        String title = (courseName != null && !courseName.trim().isEmpty()) ? courseName.trim() : "生成完成";
        String text = (label != null && !label.trim().isEmpty()) ? label.trim() : "学习内容已经生成完成";

        try {
            manager.notify(COMPLETION_BASE_ID + (int) (System.currentTimeMillis() % 1000),
                buildCompletionNotification(context, title, text));
            Log.d(TAG, "Completion notification sent: " + title);
        } catch (SecurityException e) {
            Log.w(TAG, "Cannot show completion notification — permission denied");
        }
    }

    /**
     * Build the ongoing progress notification. Must be kept in sync with
     * the fields written by updateProgress().
     */
    private static Notification buildProgressNotification(Context context, int current, int total, boolean indeterminate, String stageLabel) {
        String contentText = stageLabel;
        if (!indeterminate && total > 0) {
            int pct = Math.min(100, (current * 100) / total);
            contentText = stageLabel + " (" + pct + "%)";
        } else if (!indeterminate && total > 0) {
            contentText = stageLabel;
        }

        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_codecourse)
            .setContentTitle("正在后台生成学习内容")
            .setContentText(contentText)
            .setContentIntent(createLaunchPendingIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(total > 0 ? total : 0, current, indeterminate)
            .build();
    }

    private static Notification buildCompletionNotification(Context context, String title, String text) {
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_codecourse)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(createLaunchPendingIntent(context))
            .setOngoing(false)
            .setOnlyAlertOnce(false)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build();
    }

    private static Notification buildStartupNotification(Context context, String label) {
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_codecourse)
            .setContentTitle("正在后台生成学习内容")
            .setContentText(label != null ? label : "准备开始")
            .setContentIntent(createLaunchPendingIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(0, 0, true)
            .build();
    }

    private static PendingIntent createLaunchPendingIntent(Context context) {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, 0, launchIntent, pendingFlags);
    }

    // ---- lifecycle ----

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate");
        createNotificationChannel(this);
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "com.codecourse.app:Generation");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String label = intent == null ? null : intent.getStringExtra(EXTRA_LABEL);
        if (label == null || label.trim().isEmpty()) label = "准备开始";

        Log.d(TAG, "onStartCommand label=" + label);

        try {
            startForeground(NOTIFICATION_ID, buildStartupNotification(this, label));
        } catch (SecurityException e) {
            Log.w(TAG, "startForeground failed — notification permission denied");
        }

        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(MAX_WAKE_TIME_MS);
                Log.d(TAG, "WakeLock acquired (max " + (MAX_WAKE_TIME_MS / 60000) + " min)");
            } catch (RuntimeException e) {
                Log.w(TAG, "WakeLock acquire failed: " + e.getMessage());
            }
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.d(TAG, "onTaskRemoved — user swiped app away, stopping service");
        // Don't mark tasks as completed/done. Database tasks and checkpoints
        // are persisted by the TypeScript side. The next launch will resume.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy");
        releaseWakeLock();
        super.onDestroy();
    }

    /**
     * Android 15+ foreground service timeout callback.
     * Save recoverable state and stop cleanly to avoid RemoteServiceException.
     */
    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "onTimeout startId=" + startId + " fgsType=" + fgsType);
        // The TypeScript layer persists checkpoints and task state to the database.
        // We just need to stop cleanly — resumeTasks() will pick them up on next launch.
        stopSelf();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- helpers ----

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
                Log.d(TAG, "WakeLock released");
            } catch (RuntimeException e) {
                Log.w(TAG, "WakeLock release failed: " + e.getMessage());
            }
        }
    }

    private static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return; // already created

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "课程生成",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("在后台继续生成 CodeCourse 学习内容");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
        Log.d(TAG, "Notification channel created");
    }
}
