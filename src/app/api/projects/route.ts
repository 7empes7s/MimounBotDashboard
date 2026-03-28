export const dynamic = "force-dynamic";

import fs from "node:fs/promises";

export async function GET() {
  try {
    const raw = await fs.readFile('/home/mdefili/.openclaw/workspace/projects/registry.json', 'utf8');
    return Response.json(JSON.parse(raw));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'internal error' }, { status: 500 });
  }
}
