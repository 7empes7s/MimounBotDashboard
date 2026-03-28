import { NextResponse } from 'next/server';
import { loadCostData } from '@/lib/cost-data';

export async function GET() {
  return NextResponse.json(await loadCostData());
}
