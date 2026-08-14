import { VideoCoachExperiment } from "@/frontend/components/VideoCoachExperiment";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return {
    title: "AI 视频教练（实验）",
    description: "单圈轨迹实验：上传车载视频，浏览器本地估算走线并粗分弯道。",
  };
}

export default function VideoCoachPage() {
  return <VideoCoachExperiment />;
}
