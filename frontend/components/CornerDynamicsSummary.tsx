import type { XrkAnalysis } from "../lib/xrkAnalysisApi";

export function CornerDynamicsSummary({ analysis, locale }: { analysis: XrkAnalysis; locale: "zh" | "en" }) {
  const data = analysis.corner_dynamics;
  if (!data) return null;
  const zh = locale === "zh";
  const labels: Record<string, string> = zh ? {
    entry_speed_kmh: "入弯速度", minimum_speed_kmh: "最低速度", exit_speed_kmh: "出弯速度", elapsed_time_s: "区间用时",
    deceleration_onset: "减速开始", curvature_build_up: "曲率建立", minimum_speed: "最低速点",
    acceleration_onset: "加速开始", corner_exit: "出弯",
  } : {
    entry_speed_kmh: "Entry speed", minimum_speed_kmh: "Minimum speed", exit_speed_kmh: "Exit speed", elapsed_time_s: "Zone time",
    deceleration_onset: "Deceleration", curvature_build_up: "Curvature build-up", minimum_speed: "Minimum speed point",
    acceleration_onset: "Acceleration", corner_exit: "Corner exit",
  };
  return <section className="min-w-0 border-t border-slate-800 py-5">
    <h3 className="text-sm font-semibold text-white">{zh ? "弯道阶段与圈间重复性" : "Corner phases and repeatability"}</h3>
    <p className="mt-2 text-xs text-amber-200">{zh ? "GPS 运动学阶段，未经人工验证；不确认踏板或转向操作。仪器噪声尚未独立标定。" : "GPS kinematic phases, not manually validated or confirmed driver inputs. Sensor noise is uncalibrated."}</p>
    <p className="mt-1 text-xs text-amber-200">{zh ? "均值区间假设各圈独立且近似正态；连续圈相关或趋势可能使区间覆盖不足。经验背景排除目标和参考圈，不是显著性检验。" : "Mean intervals assume independent, approximately normal lap metrics; serial correlation or drift can cause undercoverage. Background excludes both selected laps and is not a significance test."}</p>
    {data.status !== "calculated" && <p className="mt-3 text-sm text-slate-400">{zh ? "合格 GPS 圈或弯道数据不足" : "Insufficient eligible GPS laps or zones"}</p>}
    {data.corners.map((corner) => {
      const phase = corner.phases.find((row) => row.lap === analysis.target_lap);
      return <div key={corner.zone_id} className="mt-5 border-t border-slate-800 pt-3">
        <h4 className="text-sm text-white">{corner.name}</h4>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
          {Object.entries(labels).filter(([key]) => !key.endsWith("_kmh") && key !== "elapsed_time_s").map(([key, label]) =>
            <span key={key}>{label}: {phase?.events[key] ? `${phase.events[key]!.distance_m.toFixed(1)} m` : zh ? "未识别" : "Unavailable"}</span>)}
        </p>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[660px] text-left text-xs">
            <thead className="text-slate-500"><tr>
              {(zh ? ["指标", "目标 − 参考", "有效圈", "均值 95% CI（非差值 CI）", "与圈间变动相比", "能否区别于仪器噪声"] : ["Metric", "Target − reference", "Laps", "Mean 95% CI (not effect CI)", "vs lap variation", "vs sensor noise"]).map((label) => <th className="py-2 pr-4 font-normal" key={label}>{label}</th>)}
            </tr></thead>
            <tbody className="text-slate-300">{Object.entries(corner.comparisons).map(([key, row]) => {
              const unit = key === "elapsed_time_s" ? "s" : "km/h";
              const currentInterval = row.repeatability.ci_method === "student_t_iid_mean";
              const currentBackground = row.background?.method === "leave_two_out";
              const interval = currentInterval ? row.repeatability.mean_ci95 : null;
              const outside = currentBackground && row.background?.status === "calculated" ? row.outside_observed_repeatability_band : null;
              return <tr className="border-t border-slate-800" key={key}>
                <td className="py-2 pr-4">{labels[key] ?? key}</td>
                <td>{row.target_minus_reference == null ? "—" : `${row.target_minus_reference.toFixed(3)} ${unit}`}</td>
                <td>{row.repeatability.lap_count}</td>
                <td>{interval ? `${interval.map((n) => n.toFixed(3)).join(" .. ")} ${unit}` : row.repeatability.lap_count < 5 ? (zh ? "少于 5 圈" : "Fewer than 5 laps") : (zh ? "请重新分析" : "Reanalysis required")}</td>
                <td>{outside == null ? (row.target_minus_reference == null ? (zh ? "比较圈不可用" : "Comparison lap unavailable") : currentBackground ? (zh ? "背景圈不足，无法判断" : "Insufficient background laps") : (zh ? "请重新分析" : "Reanalysis required")) : outside ? (zh ? "超出经验区间，待验证" : "Outside empirical band; unvalidated") : (zh ? "未超出经验区间" : "Within empirical band")}
                  {currentBackground && <span className="block text-slate-500">{zh ? "背景圈" : "Background laps"}: {row.background!.lap_count}</span>}
                </td>
                <td>{zh ? "尚不能判断" : "Unknown"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>;
    })}
  </section>;
}
