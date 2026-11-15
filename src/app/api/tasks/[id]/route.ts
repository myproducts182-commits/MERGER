/** عمليات مهمة واحدة: PATCH إلغاء يدوي نهائي / DELETE حذف نهائي من القاعدة */
import { NextRequest, NextResponse } from "next/server";
import { cancelTask, deleteTask } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const res = await cancelTask(id);
    if (res === "not-found") {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }
    if (res === "not-active") {
      return NextResponse.json({ error: "المهمة غير قابلة للإلغاء — انتهت بالفعل (مكتملة/فاشلة/ملغاة)" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const ok = await deleteTask(id);
    if (!ok) {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}
