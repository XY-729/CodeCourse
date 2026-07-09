## Why

Frontend hardcodes `http://localhost:8000/api` as API base. When accessing from another machine (e.g. `192.168.60.131:5173`), the browser fetches from the client's localhost instead of the VM, causing NetworkError.

## What Changes

- Change default `API_BASE` from `http://localhost:8000/api` to `/api` (same-origin)
- Add Vite dev server proxy: `/api` → `http://127.0.0.1:8000`
- Improve NetworkError message: "无法连接后端 API，请确认 FastAPI 已启动并监听 8000 端口。"
- Update README with LAN access instructions

## Capabilities

### Modified Capabilities
(none - bug fix, no spec changes)

## Impact

- `frontend/src/api/client.ts` — default API base + error message
- `frontend/vite.config.ts` — proxy config
- `frontend/.env.development` — new file for dev env var
- `README.md` — LAN access docs
