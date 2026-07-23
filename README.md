# AI Racing Telemetry Analysis Platform

赛车视频、圈速和遥测数据分析网站 MVP。当前版本重点支持在本机读取大体积车载视频，不把原始素材上传到云端，并在数据缺失时明确限制结论。

## 当前能力

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
├── scripts/                     # 本机启动、关闭脚本
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
python -m pip install -r requirements.txt
pnpm install
```

默认视频目录是 `~/Movies/Videos`。需要增加其他目录时设置：

```bash
export RACING_VIDEO_ROOTS="/path/to/videos:/another/path"
```

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

- `GET /api/video/library`：列出允许访问的本机素材。
- `POST /api/video/jobs`：创建分析任务。
- `GET /api/video/jobs/{job_id}`：读取进度、元数据、关键帧和标记。
- `GET /api/video/jobs/{job_id}/stream`：支持 Range 的原片播放。
- `GET /api/video/jobs/{job_id}/frames/{filename}`：读取关键帧。
- `POST /api/video/jobs/{job_id}/markers`：保存人工标记。
- `GET /api/video/jobs/{job_id}/markers.csv`：导出圈段映射。
- `DELETE /api/video/jobs/{job_id}`：清理该任务的本地缓存。

缓存和 SQLite 位于项目的 `storage/`，默认保留 24 小时，并已排除在 Git 之外。

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
```

## 边界与 Roadmap

当前不做自动分圈、视频计算机视觉驾驶诊断、自动视频切割或云端大文件上传。下一步优先加入对应圈速 CSV 与人工圈段的关联，再加入 Race Studio 3 遥测按距离对齐。
