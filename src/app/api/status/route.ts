import { getActivityStatus, getCredentials, getInfraSnapshot, getProviderState, getRecentLogs, getReminderSnapshot, getServiceStatuses, getUsageMetrics } from "@/lib/local-data";
import { NextResponse } from "next/server";

export async function GET() {
  const [
    services,
    sessions,
    credentials,
    logs,
    usage,
    activity,
    infra,
    reminders,
    providerState
  ] = await Promise.all([
    getServiceStatuses(),
    // We don't have a direct getSessions with transcripts in local-data that matches the dashboard expectations exactly, 
    // but the dashboard calls individual APIs. This status route is likely for the legacy status check.
    [], 
    getCredentials(),
    getRecentLogs(),
    getUsageMetrics(),
    getActivityStatus(),
    getInfraSnapshot(),
    getReminderSnapshot(),
    getProviderState()
  ]);

  return NextResponse.json({
    services,
    sessions,
    credentials,
    logs,
    usage,
    activity,
    infra,
    reminders,
    providerState,
    ts: Date.now()
  });
}
