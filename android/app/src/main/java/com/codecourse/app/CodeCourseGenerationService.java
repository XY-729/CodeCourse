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
import androidx.core.app.NotificationManagerCompat;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Foreground Service that raises process priority during user-approved
 * generation tasks, with a time-limited PARTIAL_WAKE_LOCK to reduce the
 * chance of CPU-sleep interruption during background generation.
 */
public class CodeCourseGenerationService extends Service {
    private static final String TAG = "CCGenService";

    // ---- notification channels ----
    private static final String CHANNEL_PROGRESS = "codecourse_generation_progress";
    private static final String CHANNEL_COMPLETION = "codecourse_generation_completion";

    // ---- constants ----
    private static final String EXTRA_LABEL = "label";
    private static final int PROGRESS_NOTIFICATION_ID = 2107;
    private static final int COMPLETION_NOTIFICATION_BASE = 2200;
    private static final int PERMISSION_REQUEST_CODE = 3001;
    private static final long MAX_WAKE_TIME_MS = 2L * 60L * 60L * 1000L;
    private static final int MAX_STAGE_LABEL_CHARS = 100;

    // ---- instance state ----
    private PowerManager.WakeLock wakeLock;

    // ---- static active state (thread-safe) ----
    private static final AtomicBoolean SERVICE_ACTIVE = new AtomicBoolean(false);
    private static final AtomicInteger NEXT_COMPLETION_ID = new AtomicInteger(COMPLETION_NOTIFICATION_BASE);

    // ---- session / sequence guards for stale progress ----
    private static final Object SESSION_LOCK = new Object();
    private static long sCurrentSessionId;
    private static int sCurrentTaskId;
    private static int sLastAcceptedSequence;

    // ---- public helpers ----

    public static boolean isServiceActive() {
        return SERVICE_ACTIVE.get();
    }

    public static Intent createStartIntent(Context context, String label) {
        return new Intent(context, CodeCourseGenerationService.class)
            .putExtra(EXTRA_LABEL, label);
    }

    /**
     * Update the foreground notification with real progress.
     * Silently ignores calls when the Service is not active,
     * the session has changed, or the sequence is stale.
     */
    public static void updateProgress(Context context, long sessionId, int taskId, int sequence,
                                      int current, int total, boolean indeterminate, String stageLabel,
                                      int activeTaskCount) {
        if (!SERVICE_ACTIVE.get()) return;

        // Validate session / sequence to reject late-arriving progress from old sessions
        synchronized (SESSION_LOCK) {
            if (sessionId != sCurrentSessionId) return;
            if (taskId != sCurrentTaskId) return;
            if (sequence <= sLastAcceptedSequence) return;
            sLastAcceptedSequence = sequence;
        }

        // Input validation
        int safeCurrent = Math.max(0, current);
        int safeTotal = total;
        if (safeTotal <= 0) {
            safeTotal = 0;
            indeterminate = true;
        } else if (safeCurrent > safeTotal) {
            safeCurrent = safeTotal;
        }
        String safeLabel = (stageLabel == null || stageLabel.trim().isEmpty())
            ? "正在生成学习内容"
            : stageLabel.trim();
        if (safeLabel.length() > MAX_STAGE_LABEL_CHARS) {
            safeLabel = safeLabel.substring(0, MAX_STAGE_LABEL_CHARS - 1) + "…";
        }

        int pct = (!indeterminate && safeTotal > 0) ? Math.min(100, (safeCurrent * 100) / safeTotal) : 0;
        String contentText;
        if (indeterminate) {
            contentText = safeLabel;
        } else {
            contentText = safeLabel + " · " + pct + "%";
        }
        if (activeTaskCount > 1) {
            contentText += " · 另有 " + (activeTaskCount - 1) + " 个任务";
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        try {
            manager.notify(PROGRESS_NOTIFICATION_ID,
                new NotificationCompat.Builder(context, CHANNEL_PROGRESS)
                    .setSmallIcon(R.drawable.ic_stat_codecourse)
                    .setContentTitle("正在后台生成学习内容")
                    .setContentText(contentText)
                    .setContentIntent(createLaunchPendingIntent(context, 0))
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setProgress(safeTotal > 0 ? safeTotal : 0, safeCurrent, indeterminate)
                    .build());
        } catch (SecurityException e) {
            Log.w(TAG, "Cannot update progress notification — permission denied");
        } catch (RuntimeException e) {
            Log.w(TAG, "updateProgress failed: " + e.getMessage());
        }
    }

    /**
     * Switch the foreground task to a different taskId. Called when the current
     * foreground task completes and another task takes over.
     */
    public static void switchForegroundTask(long sessionId, int newTaskId) {
        synchronized (SESSION_LOCK) {
            if (sessionId != sCurrentSessionId) return;
            sCurrentTaskId = newTaskId;
            sLastAcceptedSequence = 0;
            Log.d(TAG, "Foreground task switched to taskId=" + newTaskId);
        }
    }

    /**
     * Send a one-shot completion notification.
     * Title is always "生成完成"; task-specific info goes in the body.
     */
    public static void showCompletion(Context context, int taskId, String bodyText) {
        ensureChannels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        String body = (bodyText != null && !bodyText.trim().isEmpty())
            ? bodyText.trim()
            : "学习内容已经生成完成";

        int notificationId = COMPLETION_NOTIFICATION_BASE + (taskId > 0 ? taskId : NEXT_COMPLETION_ID.incrementAndGet());

        try {
            manager.notify(notificationId,
                new NotificationCompat.Builder(context, CHANNEL_COMPLETION)
                    .setSmallIcon(R.drawable.ic_stat_codecourse)
                    .setContentTitle("生成完成")
                    .setContentText(body)
                    .setContentIntent(createLaunchPendingIntent(context, taskId))
                    .setOngoing(false)
                    .setOnlyAlertOnce(false)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .build());
            Log.d(TAG, "Completion notification sent for taskId=" + taskId);
        } catch (SecurityException e) {
            Log.w(TAG, "Cannot show completion notification — permission denied");
        }
    }

    // ---- lifecycle ----

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "onCreate");
        ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String label = intent == null ? null : intent.getStringExtra(EXTRA_LABEL);
        if (label == null || label.trim().isEmpty()) label = "准备开始";

        Log.d(TAG, "onStartCommand startId=" + startId + " label=" + label);

        // 1. Build and post the notification
        Notification startupNotification;
        try {
            startupNotification = new NotificationCompat.Builder(this, CHANNEL_PROGRESS)
                .setSmallIcon(R.drawable.ic_stat_codecourse)
                .setContentTitle("正在后台生成学习内容")
                .setContentText(label)
                .setContentIntent(createLaunchPendingIntent(this, 0))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(0, 0, true)
                .build();
        } catch (RuntimeException e) {
            Log.w(TAG, "Failed to build startup notification: " + e.getMessage());
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // 2. Enter foreground — must succeed before Wakelock
        try {
            startForeground(PROGRESS_NOTIFICATION_ID, startupNotification);
        } catch (RuntimeException e) {
            Log.w(TAG, "startForeground failed: " + e.getClass().getSimpleName() + " — " + e.getMessage()
                + " (API " + Build.VERSION.SDK_INT + ", startId=" + startId + ")");
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // 3. Mark active — only after foreground succeeds
        SERVICE_ACTIVE.set(true);

        // 4. Acquire Wakelock — only after foreground is established
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "com.codecourse.app:generation");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(MAX_WAKE_TIME_MS);
                Log.d(TAG, "WakeLock acquired (max " + (MAX_WAKE_TIME_MS / 60000) + " min)");
            } catch (RuntimeException e) {
                Log.w(TAG, "WakeLock acquire failed: " + e.getMessage() + " — Service will run without CPU lock");
            }
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.d(TAG, "onTaskRemoved — user swiped app away, stopping service");
        SERVICE_ACTIVE.set(false);
        cancelProgressNotification();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy");
        SERVICE_ACTIVE.set(false);
        stopForegroundCompat();
        cancelProgressNotification();
        releaseWakeLock();
        super.onDestroy();
    }

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "onTimeout startId=" + startId + " fgsType=" + fgsType
            + " — dataSync time limit reached; tasks will resume from last checkpoint on next launch");
        SERVICE_ACTIVE.set(false);
        stopForegroundCompat();
        cancelProgressNotification();
        releaseWakeLock();
        stopSelfResult(startId);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- helpers ----

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "stopForeground failed: " + e.getMessage());
        }
    }

    private void cancelProgressNotification() {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(PROGRESS_NOTIFICATION_ID);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "cancel notification failed: " + e.getMessage());
        }
    }

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

    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        // Progress channel — low importance, silent
        if (manager.getNotificationChannel(CHANNEL_PROGRESS) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_PROGRESS, "后台生成", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("显示后台内容生成的进度");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
            Log.d(TAG, "Progress notification channel created");
        }

        // Completion channel — default importance, user-visible
        if (manager.getNotificationChannel(CHANNEL_COMPLETION) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_COMPLETION, "生成结果", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("内容生成完成后的提醒");
            channel.setShowBadge(true);
            manager.createNotificationChannel(channel);
            Log.d(TAG, "Completion notification channel created");
        }
    }

    private static PendingIntent createLaunchPendingIntent(Context context, int requestCode) {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, launchIntent, pendingFlags);
    }
}
