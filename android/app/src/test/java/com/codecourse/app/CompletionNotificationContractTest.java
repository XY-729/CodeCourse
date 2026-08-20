package com.codecourse.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CompletionNotificationContractTest {
    @Test
    public void normalizesEmptyAndLongBodies() {
        assertEquals("学习内容已经生成完成", CompletionNotificationContract.normalizeBody("  "));
        assertEquals("完成", CompletionNotificationContract.normalizeBody("  完成  "));

        String longText = "x".repeat(200);
        String normalized = CompletionNotificationContract.normalizeBody(longText);
        assertEquals(160, normalized.length());
        assertEquals("…", normalized.substring(159));
    }

    @Test
    public void notificationIdsAreStableAndPositive() {
        assertEquals(2201, CompletionNotificationContract.notificationId(0));
        assertEquals(2207, CompletionNotificationContract.notificationId(7));
    }
}
