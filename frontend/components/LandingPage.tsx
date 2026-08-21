import { loadServerPublicDemo } from "../lib/publicDemoServer";
import { LandingPageClient } from "./LandingPageClient";

export async function LandingPage() {
  const demo = await loadServerPublicDemo();
  return <LandingPageClient demo={demo} />;
}
