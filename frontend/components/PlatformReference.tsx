"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { getDeploymentCapabilities, type DeploymentCapabilities } from "../lib/videoApi";
import { SiteNavigation } from "./SiteNavigation";

const methods = [
  { name: "XRK 解析 / XRK parsing", tool: "libxrk · Beta", input: "AiM XRK / XRZ", zh: "读取原始时间序列、通道与圈段。无效或缺失通道保持不可用。", en: "Reads real time series, channels and lap segments. Missing or invalid channels stay unavailable.", evidence: "Measured" },
  { name: "有效圈筛选 / Lap quality", tool: "Python · Rules", input: "GPS · Time · Distance", zh: "检查圈完整性与数据覆盖。只从真实合格圈中选取比较基准，不拼接理论最快圈。", en: "Checks lap integrity and coverage. References are real eligible laps, never a stitched theoretical lap.", evidence: "Calculated" },
  { name: "圈间对齐 / Lap alignment", tool: "Distance interpolation", input: "GPS · Speed · RPM", zh: "按公共有效距离比较圈速、RPM 和速度。GPS 派生量与物理 IMU 通道分开标记。", en: "Compares time, RPM and speed over shared valid distance. GPS-derived and physical IMU channels are identified separately.", evidence: "Calculated" },
  { name: "驾驶模式 / Driver patterns", tool: "Signal rules", input: "RPM · Speed · Available sensors", zh: "输出带证据的候选减速与再加速模式。无直接刹车通道时不确认刹车动作。", en: "Produces evidence-linked candidate deceleration and recovery patterns. No confirmed braking without a direct brake channel.", evidence: "Inferred" },
  { name: "复盘叙事 / Coach narrative", tool: "OpenAI-compatible API", input: "Structured evidence only", zh: "语言模型整理后端证据，不计算圈速。缺配置、请求失败或校验不通过时，回退结构化报告。", en: "The language model explains backend evidence; it does not calculate lap times. Missing configuration, request failure or failed validation uses the structured report.", evidence: "Inferred" },
];

function ServiceStatus() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [capabilities, setCapabilities] = useState<DeploymentCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    getDeploymentCapabilities().then((value) => { if (active) setCapabilities(value); })
      .catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function refresh() {
    setLoading(true);
    setFailed(false);
    setCapabilities(null);
    try { setCapabilities(await getDeploymentCapabilities()); } catch { setFailed(true); } finally { setLoading(false); }
  }
  const unavailable = zh ? "不可用" : "Unavailable";
  return <section className="reference-status" aria-labelledby="service-title">
    <div className="reference-section-title"><h2 id="service-title">服务状态 <span>Service status</span></h2>
      <button type="button" onClick={() => void refresh()} disabled={loading} aria-label={zh ? "刷新服务状态" : "Refresh service status"} title={zh ? "刷新服务状态" : "Refresh service status"}><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button></div>
    <div role="status" aria-live="polite">
      {loading ? (zh ? "正在检查…" : "Checking…") : failed ? <p className="text-amber-200"><TriangleAlert size={16} /> {zh ? "服务暂时无法连接，CSV 与本地视频仍可使用。" : "Service unreachable. CSV and local video remain available."}</p> : <dl className="reference-status-grid">
        <div><dt>XRK Parser</dt><dd>{capabilities?.xrk_server_import.available ? `${capabilities.xrk_server_import.parser} ${capabilities.xrk_server_import.version ?? ""}` : unavailable}</dd></div>
        <div><dt>{zh ? "上传上限 / Upload limit" : "Upload limit / 上传上限"}</dt><dd>{capabilities ? `${(capabilities.xrk_server_import.max_upload_bytes / 1024 / 1024).toFixed(0)} MB` : unavailable}</dd></div>
        <div><dt>LLM Narrative</dt><dd>{capabilities?.llm_narrative.available ? capabilities.llm_narrative.model : zh ? "结构化报告回退" : "Structured fallback"}</dd></div>
        <div><dt>{zh ? "文件保存 / Retention" : "Retention / 文件保存"}</dt><dd>{zh ? "原文件临时处理 · 数据缓存 30 分钟" : "Temporary originals · 30-min data cache"}</dd></div>
      </dl>}
    </div>
  </section>;
}

export function PlatformReference({ view }: { view: "methods" | "about" }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  return <><SiteNavigation /><main className="reference-page">
    <header className="reference-heading"><p className="hero-kicker">RACING DATA LAB / COACH PILOT</p>
      <h1>{view === "methods" ? "模型介绍" : "项目介绍"}<span>{view === "methods" ? "Methods & evidence" : "About the project"}</span></h1>
      <p>{view === "methods" ? (zh ? "先计算可核实的事实，再给出有边界的解释。" : "Compute verifiable facts first, then offer bounded interpretations.") : (zh ? "面向车手与教练的真实数据复盘工具。由遥测比较进入视频核对，再安排下一次训练。" : "A real-data review tool for drivers and coaches: compare telemetry, check video, then plan the next training session.")}</p>
    </header>
    {view === "methods" ? <section className="reference-methods" aria-label="分析方法 / Analysis methods">
      <div className="reference-table-scroll"><table><thead><tr>{["模块 / Module", "输入 / Input", "方法与边界 / Method & limits", "证据 / Evidence"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{methods.map((method) => <tr key={method.name}><th scope="row">{method.name}<small>{method.tool}</small></th><td>{method.input}</td><td>{zh ? method.zh : method.en}</td><td><span className={`evidence-tag evidence-tag--${method.evidence.toLowerCase()}`}>{method.evidence}</span></td></tr>)}</tbody></table></div>
      <p className="reference-boundary"><ShieldCheck size={18} />{zh ? "不把 GPS 曲率称为转向输入，不把相关性称为因果，不把有界估计称为确定的提升。AI 生成内容请与教练核实。" : "GPS curvature is not steering input; correlation is not causation; bounded estimates are not guaranteed gains. Validate AI-generated advice with a coach."}</p>
    </section> : <section className="reference-workflows" aria-label="工作流程 / Workflows">
      {[
        { href: "/workspace", title: "遥测分析 / Telemetry", formats: "XRK · XRZ · CSV", zh: "导入、检查通道、选择真实参考圈，查看 GPS / RPM / 速度和逐弯对比。", en: "Import, inspect channels, choose a real reference lap, then compare GPS, RPM, speed and zones." },
        { href: "/video-coach", title: "视频分析 / Video", formats: "Browser-local video", zh: "本地播放、人工标记圈段与弯道、循环复盘。视频不会上传服务器；音频与视觉估计保留实验标记。", en: "Local playback, manual lap and corner markers, and review loops. Video stays on your device; audio and visual estimates remain experimental." },
        { href: "/demo", title: "公开样例 / Reviewed demo", formats: "Read-only session", zh: "无需上传即可查看已审核的匿名样例。样例不会混入你的真实 Session。", en: "Explore a reviewed anonymized session without uploading. Demo data is never mixed into your own session." },
      ].map((workflow) => <Link href={workflow.href} className="reference-workflow" key={workflow.href}><div><h2>{workflow.title}</h2><small>{workflow.formats}</small><p>{zh ? workflow.zh : workflow.en}</p></div><ArrowRight size={21} /></Link>)}
      <div className="reference-boundary"><CheckCircle2 size={18} /><p>{zh ? "当前为 Coach Pilot，不是自动驾驶教练或长期文件档案库。临时 Session 到期后需重新导入；原始文件、同步记录与车辆设定请自行保留。" : "Coach Pilot is not an automated driving coach or permanent file archive. Re-import expired sessions; retain your original files, sync records and setup notes."}</p></div>
    </section>}
    <ServiceStatus />
    <div className="reference-actions"><Link href="/workspace" className="hero-primary">{zh ? "进入遥测分析" : "Open telemetry workspace"}<ArrowRight size={17} /></Link><Link href="/video-coach" className="hero-secondary">{zh ? "打开视频分析" : "Open video review"}</Link></div>
  </main></>;
}
