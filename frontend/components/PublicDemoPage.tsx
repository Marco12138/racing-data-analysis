import { loadServerPublicDemo } from "../lib/publicDemoServer";
import { PublicDemoClient } from "./PublicDemoClient";

export async function PublicDemoPage() {
  const demo = await loadServerPublicDemo();
  return <PublicDemoClient initialDemo={demo} />;
}
