export const dynamic = "force-dynamic";

import { getUsageMetrics } from "@/lib/local-data";

export async function GET() {
  try {
    const metrics = await getUsageMetrics();
    return Response.json(metrics);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
