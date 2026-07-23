# FastAPI Backend

后端负责 CSV 分析、视频库扫描、安全 ZIP 解压、OpenCV 关键帧分析、
Range 视频播放、标记持久化和 CSV 导出。`APP_MODE=local` 保留完整本机
视频功能；`APP_MODE=cloud` 禁止扫描服务器文件系统，为对象存储上传版本
提供安全默认值。

从项目根目录启动：

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

默认只扫描 `~/Movies/Videos`。可通过 `RACING_VIDEO_ROOTS` 增加冒号分隔的本机目录。服务应保持绑定在 `127.0.0.1`，不要作为公开文件浏览器部署。

版本化 API 位于 `/api/v1`，OpenAPI 文档开发环境位于 `/docs`。生产环境
设置 `DOCS_ENABLED=false`，并显式配置 `CORS_ORIGINS` 与
`ALLOWED_HOSTS`。

容器和云部署说明见 [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)。
