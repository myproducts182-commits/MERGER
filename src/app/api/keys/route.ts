/** إدارة المفاتيح: GET (القائمة مقنعة دائمًا) / POST (إضافة أي مزود — معروف أو مخصص برابط API) */
import { NextRequest, NextResponse } from "next/server";
import { addKey, listKeys, maskKey } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** المزودات المعروفة بمحولات مدمجة (بلا رابط مخصص إلزامي) */
const KNOWN_PROVIDERS = ["kie", "cometapi"];

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
    const body = (await request.json()) as {
      provider?: string;
      api_key?: string;
      label?: string;
      base_url?: string;
      api_style?: string;
    };
    const provider = (body.provider || "").trim().toLowerCase().slice(0, 40);
    const apiKey = (body.api_key || "").trim();
    const label = (body.label || "").trim().slice(0, 100);
    const baseUrl = (body.base_url || "").trim();
    const apiStyle = body.api_style === "openai" ? "openai" : body.api_style === "kie" ? "kie" : null;

    // اسم المزود نص حر — أي مزود خدمة مقبول، بشرط صيغة معقولة
    if (!provider || !/^[a-z0-9][a-z0-9._-]{1,39}$/.test(provider)) {
      return NextResponse.json(
        { error: "اسم المزود غير صالح — أحرف لاتينية وأرقام ونقاط/شرطات فقط (مثال: kie، cometapi، myprovider)" },
        { status: 400 },
      );
    }
    // المزود المخصص (خارج المعروفين) يحتاج رابط API مخصص https
    if (!KNOWN_PROVIDERS.includes(provider) && !baseUrl) {
      return NextResponse.json(
        { error: "للمزود المخصص (خارج kie و cometapi) يجب إدخال رابط API مخصص يبدأ بـ https://" },
        { status: 400 },
      );
    }
    if (baseUrl && !/^https:\/\/[^\s]+$/i.test(baseUrl)) {
      return NextResponse.json({ error: "رابط API غير صالح — يجب أن يبدأ بـ https:// ولا يحتوي مسافات" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "أدخل المفتاح" }, { status: 400 });
    }

    const res = await addKey(provider, apiKey, label, {
      baseUrl: baseUrl || null,
      // نمط التوافق للمزود المخصص — الافتراضي «kie» (Jobs API) إن لم يُحدَّد
      apiStyle: apiStyle ?? (baseUrl && !KNOWN_PROVIDERS.includes(provider) ? "kie" : null),
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id: res.id, masked: maskKey(apiKey) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "خطأ غير متوقع" }, { status: 500 });
  }
}
