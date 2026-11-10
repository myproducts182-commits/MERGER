/** تعطيل/تنشيط مفتاح (PATCH) أو حذفه (DELETE) — لا يُعاد المفتاح الكامل أبدًا */
import { NextRequest, NextResponse } from "next/server";
import { deleteKey, getKeyById, maskKey, setKeyStatus } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as { status?: string };
    if (body.status !== "active" && body.status !== "disabled") {
      return NextResponse.json({ error: "status يجب أن يكون active أو disabled" }, { status: 400 });
    }
    const ok = await setKeyStatus(id, body.status);
    if (!ok) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });
    const key = await getKeyById(id);
    return NextResponse.json({ ok: true, status: body.status, masked: key ? maskKey(key.api_key) : undefined });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const ok = await deleteKey(id);
    if (!ok) return NextResponse.json({ error: "المفتاح غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}
