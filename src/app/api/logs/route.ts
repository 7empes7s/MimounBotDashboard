export const dynamic = "force-dynamic";

import { getRecentLogs } from "@/lib/local-data";

export async function GET() {
  try {
    const { entries, logFile } = await getRecentLogs(60);
    return Response.json({ entries, logFile });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
