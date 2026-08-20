package com.codecourse.app;

/** Pure-Java contract shared by completion notifications and navigation intents. */
final class CompletionNotificationContract {
    static final String EXTRA_PROJECT_ID = "projectId";
    static final String EXTRA_COMPLETION_TASK_ID = "completionTaskId";
    static final String EXTRA_TASK_TYPE = "taskType";
    static final String EXTRA_OUTPUT_PATH = "outputPath";

    private static final int COMPLETION_NOTIFICATION_BASE = 2200;

    private CompletionNotificationContract() {}

    static String normalizeBody(String value) {
        if (value == null || value.trim().isEmpty()) return "学习内容已经生成完成";
        String body = value.trim();
        return body.length() <= 160 ? body : body.substring(0, 159) + "…";
    }

    static int notificationId(int taskId) {
        return COMPLETION_NOTIFICATION_BASE + Math.max(1, taskId);
    }
}
