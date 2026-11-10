/** إدارة المفاتيح: GET (القائمة مقنعة دائمًا) / POST (إضافة مع رفض التكرار) */
import { NextRequest, NextResponse } from "next/server";
import { addKey, listKeys, maskKey } from "@/lib/keys";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: ProviderId[] = ["kie", "cometapi"];

export async function GET() {
  try {
    const keys = await listKeys();
    return NextResponse.json({ keys });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { provider?: string; api_key?: string; label?: string };
    const provider = body.provider as ProviderId | undefined;
    const apiKey = (body.api_key || "").trim();
    const label = (body.label || "").trim().slice(0, 100);

    if (!provider || !PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: "المزود غير صحيح — اختر kie أو cometapi" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "أدخل المفتاح" }, { status: 400 });
    }
    const res = await addKey(provider, apiKey, label);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: res.id, masked: maskKey(apiKey) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}
