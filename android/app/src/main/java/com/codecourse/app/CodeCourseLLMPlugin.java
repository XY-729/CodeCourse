package com.codecourse.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Foreground HTTPS streaming, independent of WebView CORS and fetch buffering. */
@CapacitorPlugin(name = "CodeCourseLLM")
public class CodeCourseLLMPlugin extends Plugin {
    private final Map<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void stream(PluginCall call) {
        String id = call.getString("requestId", "");
        try {
            URL url = new URL(call.getString("url", ""));
            if (!"https".equals(url.getProtocol()) || id.isEmpty()) {
                call.reject("手机版只允许使用 HTTPS 模型 API"); return;
            }
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(300000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            connection.setRequestProperty("Authorization", "Bearer " + call.getString("apiKey", ""));
            if (requests.putIfAbsent(id, connection) != null) {
                connection.disconnect(); call.reject("重复的请求编号"); return;
            }
            executor.execute(() -> {
                try {
                    if (!requests.containsKey(id)) { call.reject("回答已停止"); return; }
                    byte[] body = call.getString("body", "{}").getBytes(StandardCharsets.UTF_8);
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
                    int status = connection.getResponseCode();
                    if (status < 200 || status >= 300) {
                        call.reject("模型调用失败（" + status + "）"); return;
                    }
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        StringBuilder data = new StringBuilder();
                        while (requests.containsKey(id) && (line = reader.readLine()) != null) {
                            if (line.isEmpty()) {
                                if (data.length() > 0) { String event = data.toString(); emit(id, event); data.setLength(0); if ("[DONE]".equals(event)) break; }
                            } else if (line.startsWith("data:")) {
                                if (data.length() > 0) data.append('\n');
                                data.append(line.substring(5).trim());
                            }
                        }
                        if (data.length() > 0 && requests.containsKey(id)) emit(id, data.toString());
                    }
                    call.resolve();
                } catch (Exception error) {
                    call.reject(requests.containsKey(id) ? "模型连接中断，请重试" : "回答已停止");
                } finally {
                    requests.remove(id, connection);
                    connection.disconnect();
                }
            });
        } catch (Exception error) { call.reject("无法启动模型连接"); }
    }

    private void emit(String id, String data) {
        JSObject event = new JSObject();
        event.put("requestId", id); event.put("data", data);
        notifyListeners("chunk", event);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        HttpURLConnection connection = requests.remove(call.getString("requestId", ""));
        if (connection != null) executor.execute(connection::disconnect);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection connection : requests.values()) executor.execute(connection::disconnect);
        requests.clear(); executor.shutdown();
        super.handleOnDestroy();
    }
}
