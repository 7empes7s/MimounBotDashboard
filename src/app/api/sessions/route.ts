export const dynamic = "force-dynamic";

import { getSessions, getTranscriptMetadata } from "@/lib/local-data";

export async function GET() {
  try {
    const [sessions, transcripts] = await Promise.all([
      getSessions(),
      getTranscriptMetadata(),
    ]);
    return Response.json({ sessions, transcripts });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}
