import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = getDashboardData();
  return NextResponse.json(data);
}
