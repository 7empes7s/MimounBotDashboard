import { NextResponse } from "next/server";
import { getActivityStatus } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const activity = await getActivityStatus();
  return NextResponse.json(activity);
}
