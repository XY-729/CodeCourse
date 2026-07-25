package com.codecourse.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Foreground Service that raises process priority during generation tasks,
 * with a time-limited PARTIAL_WAKE_LOCK to reduce CPU-sleep interruptions.
 */
public class CodeCourseGenerationService extends Service {
    private static final String TAG = "CCGenService";

    private static final String CHANNEL_PROGRESS = "codecourse_generation_progress";
    private static final String CHANNEL_COMPLETION = "codecourse_generation_completion";

    // Intent extras
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_SESSION_ID = "sessionId";
    private static final String EXTRA_TASK_ID = "taskId";
    private static final String EXTRA_ACTIVE_COUNT = "activeCount";

    // Completion intent extras
    public static final String EXTRA_PROJECT_ID = "projectId";
    public static final String EXTRA_COMPLETION_TASK_ID = "completionTaskId";
    public static final String EXTRA_TASK_TYPE = "taskType";
    public static final String EXTRA_OUTPUT_PATH = "outputPath";

    private static final int PROGRESS_NOTIFICATION_ID = 2107;
    private static final int COMPLETION_NOTIFICATION_BASE = 2200;
    private static final long MAX_WAKE_TIME_MS = 2L * 60L * 60L * 1000L;
    private static final int MAX_STAGE_LABEL_CHARS = 100;

    private PowerManager.WakeLock wakeLock;

    private static final AtomicBoolean SERVICE_ACTIVE = new AtomicBoolean(false);
    private static final AtomicInteger NEXT_COMPLETION_ID = new AtomicInteger(COMPLETION_NOTIFICATION_BASE);

    private static final Object SESSION_LOCK = new Object();
    private static long sCurrentSessionId;
    private static int sCurrentTaskId;
    private static int sLastAcceptedSequence;

    // ---- public state query ----

    public static boolean isServiceActive() {
        return SERVICE_ACTIVE.get();
    }

    /**
     * Return current sessionId, taskId, and active flag for TS sync.
     */
    public static Bundle getGenerationServiceState() {
        Bundle b = new Bundle();
        b.putBoolean("active", SERVICE_ACTIVE.get());
        synchronized (SESSION_LOCK) {
            b.putLong("sessionId", sCurrentSessionId);
            b.putInt("taskId", sCurrentTaskId);
        }
        return b;
    }

    public static Intent createStartIntent(Context context, String label,
                                            long sessionId, int foregroundTaskId, int activeCount) {
        return new Intent(context, CodeCourseGenerationService.class)
            .putExtra(EXTRA_LABEL, label)
            .putExtra(EXTRA_SESSION_ID, sessionId)
            .putExtra(EXTRA_TASK_ID, foregroundTaskId)
            .putExtra(EXTRA_ACTIVE_COUNT, activeCount);
    }

    // ---- progress update ----

    public static void updateProgress(Context context, long sessionId, int taskId, int sequence,
                                      int current, int total, boolean indeterminate, String stageLabel,
                                      int activeTaskCount) {
        if (!SERVICE_ACTIVE.get()) return;

        synchronized (SESSION_LOCK) {
            if (sCurrentSessionId == 0) return; // never initialized
            if (sessionId != sCurrentSessionId) return;
            if (taskId != sCurrentTaskId) return;
            if (sequence <= sLastAcceptedSequence) return;
            sLastAcceptedSequence = sequence;
        }

        int safeCurrent = Math.max(0, current);
        int safeTotal = total;
        if (safeTotal <= 0) { safeTotal = 0; indeterminate = true; }
        else if (safeCurrent > safeTotal) safeCurrent = safeTotal;

        String safeLabel = (stageLabel == null || stageLabel.trim().isEmpty())
            ? "正在生成学习内容" : stageLabel.trim();
        if (safeLabel.length() > MAX_STAGE_LABEL_CHARS)
            safeLabel = safeLabel.substring(0, MAX_STAGE_LABEL_CHARS - 1) + "…";

        int pct = (!indeterminate && safeTotal > 0) ? Math.min(100, (safeCurrent * 100) / safeTotal) : 0;
        String contentText = indeterminate ? safeLabel : safeLabel + " · " + pct + "%";
        if (activeTaskCount > 1) contentText += " · 另有 " + (activeTaskCount - 1) + " 个任务";

        NotificationManager mgr = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) return;
        try {
            mgr.notify(PROGRESS_NOTIFICATION_ID,
                new NotificationCompat.Builder(context, CHANNEL_PROGRESS)
                    .setSmallIcon(R.drawable.ic_stat_codecourse)
                    .setContentTitle("正在后台生成学习内容")
                    .setContentText(contentText)
                    .setContentIntent(createLaunchIntent(context, 0, null))
                    .setOngoing(true).setOnlyAlertOnce(true)
                    .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setProgress(safeTotal > 0 ? safeTotal : 0, safeCurrent, indeterminate)
                    .build());
        } catch (SecurityException e) {
            Log.w(TAG, "Progress notify denied");
        } catch (RuntimeException e) {
            Log.w(TAG, "updateProgress failed: " + e.getMessage());
        }
    }

    // ---- foreground task switch ----

    public static void switchForegroundTask(long sessionId, int newTaskId) {
        synchronized (SESSION_LOCK) {
            if (sessionId != sCurrentSessionId) return;
            sCurrentTaskId = newTaskId;
            sLastAcceptedSequence = 0;
            Log.d(TAG, "Foreground task switched to " + newTaskId);
        }
    }

    // ---- completion ----

    public static void showCompletion(Context context, int taskId, int projectId,
                                       String taskType, String outputPath, String bodyText) {
        ensureChannels(context);
        NotificationManager mgr = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) return;

        String body = (bodyText != null && !bodyText.trim().isEmpty())
            ? bodyText.trim() : "学习内容已经生成完成";
        int nid = COMPLETION_NOTIFICATION_BASE + (taskId > 0 ? taskId : NEXT_COMPLETION_ID.incrementAndGet());

        Bundle extras = new Bundle();
        extras.putInt(EXTRA_PROJECT_ID, projectId);
        extras.putInt(EXTRA_COMPLETION_TASK_ID, taskId);
        extras.putString(EXTRA_TASK_TYPE, taskType);
        extras.putString(EXTRA_OUTPUT_PATH, outputPath != null ? outputPath : "");

        try {
            mgr.notify(nid,
                new NotificationCompat.Builder(context, CHANNEL_COMPLETION)
                    .setSmallIcon(R.drawable.ic_stat_codecourse)
                    .setContentTitle("生成完成")
                    .setContentText(body)
                    .setContentIntent(createLaunchIntent(context, taskId, extras))
                    .setOngoing(false).setOnlyAlertOnce(false)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true)
                    .build());
            Log.d(TAG, "Completion sent taskId=" + taskId + " projectId=" + projectId);
        } catch (SecurityException e) {
            Log.w(TAG, "Completion notify denied");
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
        String label = intent != null ? intent.getStringExtra(EXTRA_LABEL) : null;
        long sessionId = intent != null ? intent.getLongExtra(EXTRA_SESSION_ID, 0) : 0;
        int taskId = intent != null ? intent.getIntExtra(EXTRA_TASK_ID, 0) : 0;
        int activeCount = intent != null ? intent.getIntExtra(EXTRA_ACTIVE_COUNT, 1) : 1;

        if (label == null || label.trim().isEmpty()) label = "准备开始";

        Log.d(TAG, "onStartCommand startId=" + startId + " sessionId=" + sessionId
            + " taskId=" + taskId + " activeCount=" + activeCount);

        // Validate parameters
        if (sessionId <= 0 || taskId <= 0) {
            Log.e(TAG, "Invalid session params: sessionId=" + sessionId + " taskId=" + taskId + " — stopping");
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // 1. Build notification
        Notification startupNotif;
        try {
            startupNotif = new NotificationCompat.Builder(this, CHANNEL_PROGRESS)
                .setSmallIcon(R.drawable.ic_stat_codecourse)
                .setContentTitle("正在后台生成学习内容")
                .setContentText(label)
                .setContentIntent(createLaunchIntent(this, 0, null))
                .setOngoing(true).setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(0, 0, true)
                .build();
        } catch (RuntimeException e) {
            Log.w(TAG, "Build notification failed: " + e.getMessage());
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // 2. Enter foreground
        try {
            startForeground(PROGRESS_NOTIFICATION_ID, startupNotif);
        } catch (RuntimeException e) {
            Log.w(TAG, "startForeground failed: " + e.getClass().getSimpleName()
                + " API=" + Build.VERSION.SDK_INT + " startId=" + startId);
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        // 3. Initialize session — only after foreground succeeds
        synchronized (SESSION_LOCK) {
            sCurrentSessionId = sessionId;
            sCurrentTaskId = taskId;
            sLastAcceptedSequence = 0;
        }
        SERVICE_ACTIVE.set(true);

        // 4. Wakelock
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
                Log.d(TAG, "WakeLock acquired");
            } catch (RuntimeException e) {
                Log.w(TAG, "WakeLock acquire failed: " + e.getMessage());
            }
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.d(TAG, "onTaskRemoved");
        SERVICE_ACTIVE.set(false);
        clearSession();
        cancelProgressNotification();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "onDestroy");
        SERVICE_ACTIVE.set(false);
        clearSession();
        stopForegroundCompat();
        cancelProgressNotification();
        releaseWakeLock();
        super.onDestroy();
    }

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.w(TAG, "onTimeout startId=" + startId + " fgsType=" + fgsType);
        SERVICE_ACTIVE.set(false);
        clearSession();
        stopForegroundCompat();
        cancelProgressNotification();
        releaseWakeLock();
        stopSelfResult(startId);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ---- helpers ----

    private void clearSession() {
        synchronized (SESSION_LOCK) {
            sCurrentSessionId = 0;
            sCurrentTaskId = 0;
            sLastAcceptedSequence = 0;
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (RuntimeException e) { Log.w(TAG, "stopForeground: " + e.getMessage()); }
    }

    private void cancelProgressNotification() {
        try {
            NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (mgr != null) mgr.cancel(PROGRESS_NOTIFICATION_ID);
        } catch (RuntimeException e) { Log.w(TAG, "cancel: " + e.getMessage()); }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); Log.d(TAG, "WakeLock released"); }
            catch (RuntimeException e) { Log.w(TAG, "WakeLock release: " + e.getMessage()); }
        }
    }

    private static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr == null) return;
        if (mgr.getNotificationChannel(CHANNEL_PROGRESS) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_PROGRESS, "后台生成", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("显示后台内容生成的进度");
            ch.setShowBadge(false); ch.setSound(null, null); ch.enableVibration(false);
            mgr.createNotificationChannel(ch);
        }
        if (mgr.getNotificationChannel(CHANNEL_COMPLETION) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_COMPLETION, "生成结果", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("内容生成完成后的提醒");
            ch.setShowBadge(true);
            mgr.createNotificationChannel(ch);
        }
    }

    private static PendingIntent createLaunchIntent(Context ctx, int requestCode, @Nullable Bundle extras) {
        Intent i = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (extras != null) i.putExtras(extras);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, requestCode, i, flags);
    }
}
