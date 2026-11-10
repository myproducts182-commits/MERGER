/** فحص الجهوزية: قاعدة البيانات + خدمة الدمج + الموديلات + حالة الحماية */
import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/turso";
import { mergerHealthy } from "@/lib/merger";
import { mergerBase } from "@/lib/env";
import { MODELS } from "@/lib/models";
import { isMcpAuthRequired } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbOk = await dbHealthy();
  const mergerOk = await mergerHealthy();
  const body = {
    ok: dbOk,
    database: dbOk ? "turso-connected" : "turso-disconnected",
    mcpEndpoint: "/mcp",
    models: MODELS.map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers })),
    merger: { base: mergerBase() || "غير مضبوط", healthy: mergerOk },
    authRequired: isMcpAuthRequired(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
