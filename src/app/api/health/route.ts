export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    app: "baba-mimoun-ops-dashboard",
    ts: Date.now(),
  });
}
