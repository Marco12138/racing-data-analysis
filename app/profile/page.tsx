import { DriverProfilePage } from "@/frontend/components/DriverProfilePage";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return {
    title: "车手档案",
    description: "本机保存的成长档案：跨 session 追踪最快圈、反复弱点与本周训练重点。",
  };
}

export default function ProfilePage() {
  return <DriverProfilePage />;
}
