export const dynamic = "force-dynamic";

import { getSessionDrilldown } from "@/lib/local-data";

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const data = await getSessionDrilldown(sessionId);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "internal error" }, { status: 500 });
  }
}
