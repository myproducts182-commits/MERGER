/** لوحة المهام للواجهة: الإحصائيات + أحدث المهام (تُحدَّث تلقائيًا كل ~5 ثوانٍ من الواجهة) */
import { NextRequest, NextResponse } from "next/server";
import { listRecentTasks, taskStats } from "@/lib/tasks";
import type { MediaType, TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") || "20", 10) || 20));
    const type = (sp.get("type") || undefined) as MediaType | undefined;
    const status = (sp.get("status") || undefined) as TaskStatus | undefined;

    const [stats, tasks] = await Promise.all([taskStats(), listRecentTasks(limit, { type, status })]);
    return NextResponse.json({
      stats,
      tasks: tasks.map((t) => ({
        id: t.id,
        type: t.type,
        model: t.model,
        provider: t.provider,
        status: t.status,
        progress: t.progress,
        prompt: t.prompt,
        result_urls: t.result_urls,
        error_message: t.error_message,
        attempts_count: t.attempts.length,
        created_at: t.created_at,
        completed_at: t.completed_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}
