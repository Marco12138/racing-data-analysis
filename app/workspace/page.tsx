import { RacingDashboard } from "@/frontend/components/RacingDashboard";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  return <RacingDashboard initialDemo={params.demo === "1"} />;
}
