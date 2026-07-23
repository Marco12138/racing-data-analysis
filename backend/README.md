# Local FastAPI Backend

本机后端负责 CSV 分析、视频库扫描、安全 ZIP 解压、OpenCV 关键帧分析、Range 视频播放、SQLite 标记持久化和 CSV 导出。

从项目根目录启动：

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

默认只扫描 `~/Movies/Videos`。可通过 `RACING_VIDEO_ROOTS` 增加冒号分隔的本机目录。服务应保持绑定在 `127.0.0.1`，不要作为公开文件浏览器部署。
