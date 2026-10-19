import { VideoAnalysisWorkspace } from "@/frontend/components/VideoAnalysisWorkspace";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return {
    title: "视频复盘 · 双车手对照 | Video review",
    description: "本地车载视频并排复盘，人工起点后五秒与参照物二次核对。Local two-driver video comparison with manual starts and landmark checks.",
  };
}

export default function VideoCoachPage() {
  return <VideoAnalysisWorkspace />;
}
