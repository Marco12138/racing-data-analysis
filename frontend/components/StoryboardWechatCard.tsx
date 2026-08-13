import type { StoryboardResponse } from "../lib/storyboardApi";
import type { Ref } from "react";

export function StoryboardWechatCard({
  storyboard,
  qrDataUrl,
  cardRef,
}: {
  storyboard: StoryboardResponse;
  qrDataUrl: string;
  cardRef?: Ref<HTMLElement>;
}) {
  const fastest = storyboard.analysis.fastest_lap;
  const points = storyboard.nodes.slice(0, 3);
  return (
    <article ref={cardRef} className="wechat-card" aria-label="AI 驾驶复盘朋友圈长图">
      <header className="wechat-card__header">
        <p>RACING DATA LAB · REAL LAP EVIDENCE</p>
        <h2>AI 驾驶复盘</h2>
        <span>把最快的真实圈，拆成下一节能验证的训练动作</span>
      </header>

      <section className="wechat-card__session">
        <dl>
          <div><dt>车手</dt><dd>{storyboard.analysis.driver || "未填写"}</dd></div>
          <div><dt>车辆</dt><dd>{storyboard.analysis.vehicle || "未填写"}</dd></div>
          <div><dt>赛道</dt><dd>{storyboard.analysis.track || "未填写"}</dd></div>
        </dl>
        <div className="wechat-card__lap">
          <span>最快有效圈</span>
          <strong>{fastest ? `${fastest.lap_time.toFixed(3)}s` : "N/A"}</strong>
          <small>{fastest ? `Lap ${fastest.lap}` : "真实圈计时不可用"}</small>
        </div>
      </section>

      <section className="wechat-card__points">
        <p className="wechat-card__eyebrow">本次训练重点</p>
        {points.map((node, index) => (
          <div className="wechat-card__point" key={node.id}>
            <span className="wechat-card__point-index">0{index + 1}</span>
            <div>
              <h3>{node.title}</h3>
              <p>{node.insight}</p>
              <small>
                {node.corner
                  ? `${node.corner.entry_distance_m.toFixed(0)}–${node.corner.exit_distance_m.toFixed(0)} m`
                  : `${node.distance_range_m[0].toFixed(0)}–${node.distance_range_m[1].toFixed(0)} m`}
                {` · ${node.source === "llm" ? "AI 叙事" : "结构化证据"}`}
              </small>
            </div>
          </div>
        ))}
      </section>

      <footer className="wechat-card__footer">
        <div>
          <strong>扫码查看完整复盘</strong>
          <span>圈速 · 遥测 · 视频时间轴证据</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} width={220} height={220} alt="分享页二维码" />
      </footer>
      <p className="wechat-card__watermark">AI 生成，请与教练核实 · 所有参考数据均来自真实完成圈</p>
    </article>
  );
}
