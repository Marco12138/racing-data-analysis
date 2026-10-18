"""Render an offline private review sheet; video selection never leaves the browser."""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw


def contact_sheet(directory: Path, window: dict) -> None:
    """Show exact source frames, without image registration or visual enhancement."""
    canvas = Image.new("RGB", (1440, 876), "#141c20")
    draw = ImageDraw.Draw(canvas)
    for row, (lap, clip) in enumerate(window["clips"].items()):
        for column, frame in enumerate(clip["frames"]):
            image = Image.open(directory/"frames"/(frame["frame"]+".jpg")).resize((480, 270))
            canvas.paste(image, (column*480, row*292+22))
            draw.text((column*480+5, row*292+4),
                      f"L{lap}  {frame['time_s']:.3f}s  +{column*2.5:.1f}s", fill="white")
    canvas.save(directory/(window["id"]+".jpg"))


def main() -> None:
    """Build JSON-backed HTML and concise Markdown with no persistence or requests."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if not directory.is_relative_to(Path("tmp").resolve()):
        parser.error("Private report must stay under tmp/.")
    manifest = json.loads((directory/"frames.json").read_text())
    visual = json.loads((directory/"visual-results.json").read_text())
    anchor = manifest["anchor"]
    notes_path = directory/"review-notes.json"
    notes = json.loads(notes_path.read_text()) if notes_path.exists() else None
    titles = {"lap_start": "计时圈起点：从人工锚点向后推算", "sector_1": "Sector 1 候选：连续弯前", "sector_2": "Sector 2 候选：分界附近",
              "sector_3": "Sector 3 候选：与上一片段几乎重复", "extra_1": "补查：首组弯入口",
              "extra_2": "重点补查：GPS 速度不一致区域"}
    labels = {"candidate": "相似画面候选，未人工确认", "ambiguous": "多个相似位置，不能唯一定位", "weak": "视觉证据不足"}
    lines = ["# 真实圈片段边界核对", "", "仅本地审计，未更新任何人工锚点或公网判定。",
             f"人工输入：L{anchor['lap']} 从 {anchor['video_start_s']:.3f}s 开始；用户估计选点误差约 ±{anchor['user_estimated_uncertainty_s']:.1f}s（非统计置信区间）。",
             f"视频 = 遥测 session time + {anchor['offset_s']:.3f}s。所有目标片段长度为 5s。",
             "两个背景区域复用网站现有匹配器，0.72/0.06 阈值未改。分数不是准确率。",
             "非对应时段的分数仅为描述性对照，不是独立随机实验或 p 值。", ""]
    review_notes = ""
    if notes:
        lines += ["## 图像观察与待确认清单", "", notes["summary"], ""]
        lines.extend(f"- {finding}" for finding in notes["findings"])
        rows = []
        for item in notes["confirmations"]:
            lines.append(f"\n**{item['priority']}**：{item['reference']} 对 {item['target']}。{item['question']}")
            rows.append('<tr>'+''.join(f'<td>{html.escape(item[key])}</td>' for key in ("priority", "reference", "target"))+
                        f'<td>{html.escape(item["question"])} <a href="#{html.escape(item["section"])}">查看</a></td></tr>')
        review_notes = f'<section><h2>观察结果与待确认片段</h2><p>{html.escape(notes["summary"])}</p>'
        review_notes += '<ul>'+''.join(f'<li>{html.escape(f)}</li>' for f in notes["findings"][:4])+'</ul>'
        review_notes += '<div class="table"><table><thead><tr><th>优先级</th><th>参考</th><th>目标</th><th>需确认</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div></section>'
        lines += ["", notes["next_algorithm_boundary"], ""]
    parts = []
    for window in manifest["windows"]:
        contact_sheet(directory, window)
        title = titles[window["id"]]
        lines += [f"## {title}", "", f"共同起点：参考圈距离 {window['start_distance_m']:.3f}m（仅审计定位用）。"]
        videos = []
        for lap, clip in window["clips"].items():
            lines.append(f"- L{lap}: {clip['start_s']:.3f}–{clip['end_s']:.3f}s；T+5 位置 {clip['end_distance_m']:.2f}m。")
            videos.append(f'<div><h3>L{lap} · {clip["start_s"]:.3f}–{clip["end_s"]:.3f}s</h3>'
                          f'<video controls playsinline preload="metadata" data-start="{clip["start_s"]}" data-end="{clip["end_s"]}" poster="frames/{clip["frames"][0]["frame"]}.jpg"></video></div>')
        rows = []
        for pair in [p for p in visual["pairs"] if p["id"] == window["id"]]:
            lines += [f"\nL{pair['target_lap']} 对 L{pair['reference_lap']}：GPS 警告区间重叠 {pair['gps_warning_overlap_s']:.3f}s；"
                      f"5 秒尾点相对参考圈距离差 {pair['end_position_difference_m']:+.2f}m。"]
            for check in pair["checks"]:
                for patch in check["patches"]:
                    best = patch["ranked"]["candidate"]
                    shift = f"{patch['best_shift_s']:+.3f}s" if best else "无可靠候选"
                    score = f"{best['score']:.3f}" if best else "—"
                    predicted_score = f"{patch['predicted']['score']:.3f}" if patch['predicted']['score'] is not None else "不足"
                    name = f"L{pair['target_lap']} {'起点' if check['boundary'] == 'start' else '尾点'} / {patch['region']}"
                    control = patch['control_exceedance_fraction']
                    controls = f"{control:.3f}" if control is not None else "不足"
                    lines.append(f"- {name}: 当前分数 {predicted_score}，搜索峰 {score}，差值 {shift}；{labels[patch['ranked']['status']]}；非对应时段分数达到搜索峰的比例 {controls}。")
                    rows.append(f"<tr><td>{name}</td><td>{predicted_score}</td><td>{score}</td><td>{shift}</td><td>{labels[patch['ranked']['status']]}</td></tr>")
        lines += ["", f"![逐帧对照]({window['id']}.jpg)", ""]
        parts.append(f'<section id="{window["id"]}"><h2>{title}</h2><div class="clips">{"".join(videos)}</div>'
                     '<button class="play">播放本组 5 秒</button><button class="pause">暂停</button>'
                     f'<a href="{window["id"]}.jpg">查看原图</a><img class="sheet" src="{window["id"]}.jpg" alt="三圈起点、中间、尾点"/>'
                     '<details><summary>视觉候选证据（不是准确率）</summary><div class="table"><table><thead><tr><th>位置</th><th>推算帧</th><th>搜索峰</th><th>峰值时间差</th><th>状态</th></tr></thead><tbody>'
                     + "".join(rows) + '</tbody></table></div></details></section>')
    anchors = "".join(f'<figure><img src="frames/{f["frame"]}.jpg"/><figcaption>{f["time_s"]:.3f}s</figcaption></figure>' for f in anchor["frames"])
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>真实圈视频边界核对</title>
<style>*{box-sizing:border-box}body{margin:0;background:#10171c;color:#edf3f6;font:15px/1.65 system-ui,sans-serif;letter-spacing:0}main{max-width:1500px;margin:auto;padding:24px}h1{font-size:26px}h2{font-size:21px}h3{font-size:15px}header{border-bottom:1px solid #40505b;padding-bottom:20px}section{padding:22px 0;border-bottom:1px solid #40505b}p{color:#b8c8d0}a{color:#5bdfcd;margin:0 10px}button,input{font:inherit;color:inherit;background:#20333b;border:1px solid #617681;border-radius:4px;padding:8px 12px;margin:8px 8px 8px 0}button{cursor:pointer}video{width:100%;aspect-ratio:16/9;background:#000}.clips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.sheet{width:100%;height:auto;margin-top:10px}table{border-collapse:collapse;white-space:nowrap}th,td{border-bottom:1px solid #40505b;padding:8px;text-align:left}.table{overflow:auto}.anchor{display:flex;gap:12px;overflow:auto}.anchor figure{min-width:300px;margin:0}.anchor img{width:300px}.warning{color:#ffd778}summary{cursor:pointer}#status{color:#ffd778}@media(max-width:700px){main{padding:14px}.clips{grid-template-columns:1fr}h1{font-size:22px}}</style><main>
'''
    page += f'<header><h1>真实圈 · 视频边界核对</h1><p>L{anchor["lap"]} 人工起点 {anchor["video_start_s"]:.3f}s；自报选点误差约 ±{anchor["user_estimated_uncertainty_s"]:.1f}s。锚点未改，全部目标片段仍待人工确认。</p>'
    page += '<p class="warning">固定 5 秒用于回放，不代表两圈终点位置相同。GPS 不一致窗口仍保留警告，图像相似不使它通过。</p><label>本地原视频 <input type="file" accept="video/mp4" id="file"></label><span id="status">尚未选择视频</span></header>'
    page += '<details><summary>人工起点前后 0.5 秒原帧</summary><div class="anchor">'+anchors+'</div></details>'
    page += review_notes
    page += "".join(parts)
    page += f'<footer><p>私有本地报告。输入文件：{html.escape(Path(manifest["video"]["path"]).name)}。无上传、无反馈提交、无自动锚点修正。</p></footer></main>'
    page += f'<script>const expectedSize={manifest["video"]["size_bytes"]};</script>'
    page += '''<script>
let url=null;const all=[...document.querySelectorAll('video')];
document.querySelector('#file').onchange=e=>{const file=e.target.files[0];if(!file)return;
if(file.size!==expectedSize){document.querySelector('#status').textContent='文件大小不符，请选择本次核对的原片';return}
all.forEach(v=>{v.pause();v.removeAttribute('src');v.load()});
if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);
document.querySelector('#status').textContent='仅本机播放 · '+file.name};
all.forEach(v=>{const check=t=>{const end=Number(v.dataset.end);if(t>=end){v.pause();if(Math.abs(v.currentTime-end)>.001)v.currentTime=end}};
v.ontimeupdate=()=>check(v.currentTime);
if(v.requestVideoFrameCallback){let active=false;const tick=(_,m)=>{check(m.mediaTime);if(!v.paused)v.requestVideoFrameCallback(tick);else active=false};
v.addEventListener('play',()=>{if(!active){active=true;v.requestVideoFrameCallback(tick)}})}});
document.querySelectorAll('section[id]').forEach(s=>{const vs=[...s.querySelectorAll('video')];
s.querySelector('.play').onclick=()=>{if(!url)return;all.forEach(v=>{v.pause();if(!vs.includes(v)&&v.hasAttribute('src')){v.removeAttribute('src');v.load()}});
vs.forEach(v=>{const play=()=>{v.currentTime=Number(v.dataset.start);v.play().catch(()=>{document.querySelector('#status').textContent='视频无法播放，请检查本地文件'})};
if(!v.hasAttribute('src')){v.onloadedmetadata=play;v.src=url}else play()})};
s.querySelector('.pause').onclick=()=>vs.forEach(v=>v.pause())});
window.addEventListener('beforeunload',()=>{if(url)URL.revokeObjectURL(url)});
</script>'''
    (directory/"report.html").write_text(page)
    (directory/"report.md").write_text("\n".join(lines)+"\n")
    print(json.dumps({"html": str(directory/"report.html"), "contact_sheets": len(manifest["windows"])}))


if __name__ == "__main__":
    main()
