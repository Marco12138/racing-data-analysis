# AI Racing Telemetry Analysis Platform

赛车视频、圈速和遥测数据分析网站 MVP。公开 Demo 可直接体验样例
session、上传 CSV、查看图表和报告，并在浏览器中读取视频信息与第一帧；
本机模式继续支持大体积车载视频分析。

## 当前能力

- 公开落地页与显式 `Try Demo` 流程，无数据也能体验完整 Dashboard。
- 在浏览器中分析 lap/sector 和 telemetry CSV，不依赖 `localhost`。
- 上传视频后显示文件信息、时长、分辨率和第一帧，文件不会离开浏览器。
- 从本机白名单目录发现 MP4、MOV 和 ZIP。
- 安全解压 ZIP 到独立缓存，原文件保持不变。
- 使用 OpenCV 读取时长、帧率、帧数、分辨率和编码。
- 均匀抽取 12 张关键帧并计算基础亮度、清晰度指标。
- 原片流式播放、关键帧跳转、人工圈开始/结束、弯道和事件标记。
- 导出 `lap,video_start_time,video_end_time,notes` CSV。
- 可选导入 lap/sector CSV 和 telemetry CSV，继续使用已有圈速、sector loss 和遥测图表。
- 未提供 CSV 时不显示虚假的最快圈、sector loss、车速或车辆动态诊断。

## 项目结构

```text
racing-ai-platform/
├── app/                         # Next/Sites 页面入口与元数据
├── frontend/
│   ├── components/              # 仪表盘与视频工作区
│   └── lib/                     # CSV 分析和本地视频 API 客户端
├── backend/
│   ├── app/
│   │   ├── api/                 # 视频 API 路由
│   │   ├── analysis/            # 圈速、遥测、视频分析
│   │   ├── models/              # 请求模型
│   │   └── utils/               # SQLite、视频库和安全解压
│   └── tests/
├── docker/                      # 前端与 FastAPI 生产镜像
├── docs/
│   ├── ARCHITECTURE.md          # 当前边界与多用户演进架构
│   └── DEPLOYMENT.md            # Vercel、容器和云服务部署说明
├── scripts/                     # 本机启动、关闭脚本
├── docker-compose.yml           # 本机容器化运行
├── vercel.json                  # Vercel Next.js 构建
├── railway.toml                 # FastAPI Railway 示例
├── 启动赛车分析网站.command       # macOS 双击启动器
├── 关闭赛车分析网站.command       # macOS 双击关闭器
├── requirements.txt
└── pytest.ini
```

## 搭建过程

1. **基础 Web MVP**：完成圈速与遥测 CSV 解析、sector 对比、驾驶行为启发式分析和工程仪表盘。
2. **本机视频工作区**：加入白名单目录扫描、安全 ZIP 解压、OpenCV 元数据与关键帧分析、Range 播放和人工标记。
3. **本机一键运行**：增加前后端联合启动、健康检查、后台日志和 macOS 双击启动/关闭入口。
4. **数据边界强化**：原始视频、SQLite、缓存、日志、外部 CSV 和生成报告均保留在本机，不进入版本库。

仓库中的前端合成数据仅用于演示和渲染测试，不对应真实车手或赛道。真实视频、遥测、圈速和生成结果不随源码发布。

## 安装

```bash
git clone https://github.com/Marco12138/racing-data-analysis.git
cd racing-data-analysis
python -m pip install -r requirements-dev.txt
pnpm install
```

默认视频目录是 `~/Movies/Videos`。需要增加其他目录时设置：

```bash
export RACING_VIDEO_ROOTS="/path/to/videos:/another/path"
```

环境变量模板：

- `.env.development.example`：本机开发；
- `.env.production.example`：公开部署；
- `.env.example`：完整常用配置。

复制为 `.env.local` 后再填写本机路径或部署参数。密钥不得使用
`NEXT_PUBLIC_` 前缀。

## 启动

macOS 推荐直接在 Finder 中双击：

```text
启动赛车分析网站.command
```

脚本会在后台启动前端和后端、等待服务就绪，然后自动打开浏览器。使用完毕后双击 `关闭赛车分析网站.command`。

也可以在终端启动：

```bash
./scripts/start-local.sh
```

打开 `http://localhost:3000`。后端只监听 `127.0.0.1:8000`。

也可以分别启动：

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
pnpm run dev
```

## 本机视频验证

平台已使用本机 4K/HEVC 长视频验证 ZIP 解压、元数据读取、12 张关键帧抽取、流式播放和人工圈段标记。原始文件名、缓存路径、关键帧和分析报告不会提交到仓库。

如果没有对应圈速、sector 或遥测 CSV，平台不会输出 sector 损失、真实车速、制动压力、油门开度、转向不足或转向过度结论。

## 本地视频 API

- `GET /api/v1/system/capabilities`：查询当前部署支持的能力。
- `GET /api/v1/system/health/live`：进程存活检查。
- `GET /api/v1/system/health/ready`：依赖就绪检查。
- `POST /api/v1/analysis`：上传圈速和可选遥测 CSV。
- `GET /api/video/library`：列出允许访问的本机素材。
- `POST /api/video/jobs`：创建分析任务。
- `GET /api/video/jobs/{job_id}`：读取进度、元数据、关键帧和标记。
- `GET /api/video/jobs/{job_id}/stream`：支持 Range 的原片播放。
- `GET /api/video/jobs/{job_id}/frames/{filename}`：读取关键帧。
- `POST /api/video/jobs/{job_id}/markers`：保存人工标记。
- `GET /api/video/jobs/{job_id}/markers.csv`：导出圈段映射。
- `DELETE /api/video/jobs/{job_id}`：清理该任务的本地缓存。

新客户端使用 `/api/v1/video/...`；原 `/api/video/...` 路径作为 MVP
兼容接口保留。缓存和 SQLite 位于项目的 `storage/`，默认保留 24
小时，并已排除在 Git 之外。

## Docker

```bash
docker compose up --build
```

前端位于 `http://localhost:3000`，API 位于
`http://localhost:8000/api/v1`。Compose 将 `~/Movies/Videos` 以只读方式
挂载到后端。

## 公开部署方向

第一阶段公开 Demo 推荐：

- Vercel：Next.js 前端；
- Railway / Render：使用根目录 `Dockerfile` 部署可选 FastAPI 服务。

当前公开 Dashboard 的 Demo 数据、CSV 分析和视频首帧预览都可在浏览器
完成，不要求 PostgreSQL、Redis、用户系统或对象存储。

当前 `APP_MODE=cloud` 会主动关闭服务器本机目录扫描。公开视频上传应采用
浏览器直传对象存储，不能让 Vercel 或 FastAPI 转发数 GB 视频。完整边界见
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，部署步骤见
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## Frontend Deployment

1. 将仓库连接到 GitHub。
2. 在 Vercel 中导入仓库，保持项目根目录不变。
3. 设置 `NEXT_PUBLIC_API_URL=https://<backend-domain>`、
   `NEXT_PUBLIC_API_PREFIX=/api/v1` 和
   `NEXT_PUBLIC_DEPLOYMENT_MODE=public-demo`。
4. 点击 Deploy；Vercel 会按 `vercel.json` 执行生产构建。

暂时没有公开后端时，仍可先部署前端；浏览器端 Demo、CSV 分析和视频
首帧预览不受影响。

## Backend Deployment

1. 在 Railway 或 Render 中连接同一个 GitHub 仓库。
2. 选择根目录 `Dockerfile`，平台会启动
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`。
3. 设置 `APP_ENV=production`、`APP_MODE=cloud`、
   `CORS_ORIGINS=https://<frontend-domain>` 和平台对应的
   `ALLOWED_HOSTS`。
4. 将健康检查路径设置为 `/api/v1/health`；成功响应为
   `{"status":"ok"}`。

部署后前端通常为 `https://<project>.vercel.app`，后端通常为
`https://<service>.up.railway.app` 或 `https://<service>.onrender.com`。

## CSV 格式

Lap/Sector CSV 自动识别所有 `sector_` 列：

```csv
lap,lap_time,sector_1,sector_2,sector_3,notes
1,52.341,17.232,18.104,17.005,warm up
```

Telemetry CSV 可包括：

```csv
time,lap,distance,speed,throttle,brake,steering_angle,rpm,gear,lateral_g,longitudinal_g,gps_lat,gps_lon
0.000,1,0.0,42.1,0.0,0.0,2.1,6500,3,0.12,0.03,,
```

## 测试

```bash
python -m pytest -q
pnpm run build
pnpm run build:vercel
```

## 边界与 Roadmap

当前不做自动分圈、视频计算机视觉驾驶诊断、自动视频切割或云端大文件上传。生产化下一步优先完成 PostgreSQL repository、对象存储直传、用户身份和独立任务 worker；分析功能仍优先加入对应圈速 CSV 与人工圈段的关联，再加入 Race Studio 3 遥测按距离对齐。
