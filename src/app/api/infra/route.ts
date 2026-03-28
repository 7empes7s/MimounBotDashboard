export const dynamic = "force-dynamic";

import { getInfraSnapshot } from "@/lib/local-data";

export async function GET() {
  try {
    const data = await getInfraSnapshot();
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
