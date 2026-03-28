export const dynamic = "force-dynamic";

import { getServiceStatuses } from "@/lib/local-data";

export async function GET() {
  try {
    const services = await getServiceStatuses();
    return Response.json({ services });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
