export const dynamic = "force-dynamic";

import { getCredentials } from "@/lib/local-data";

export async function GET() {
  try {
    const credentials = await getCredentials();
    return Response.json({ credentials });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
