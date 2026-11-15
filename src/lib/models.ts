/**
 * سجل الموديلات — الافتراضيات المدمجة + قبول أي اسم موديل يمرره العميل.
 * الموديلات المدمجة تُوحَّد أسماؤها (نقاط/شرطات) وتُترجم لاسم كل مزود؛
 * أي اسم آخر صالح الصيغة يُمرَّر كما هو لكل المزودين (موديل مخصص)،
 * وعندها تُجرَّب كل المفاتيح النشطة أيًا كان مزودها.
 */
import type { MediaType } from "./types";

export interface ModelDef {
  canonical: string;
  aliases: string[];
  type: MediaType;
  /** المزودات المرشحة — ["*"] تعني كل المفاتيح النشطة أيًا كان مزودها */
  providers: string[];
  /** ترجمة الاسم لكل مزود — عند غياب المدخل يُمرَّر canonical كما هو */
  providerModel: Record<string, string>;
}

const DEFAULT_IMAGE = process.env.DEFAULT_IMAGE_MODEL || process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const DEFAULT_VIDEO = process.env.DEFAULT_VIDEO_MODEL || process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";

/** الاسم الافتراضي لكل نوع (قابل للتجاوز بمتغيرات البيئة) */
export function defaultModelFor(type: "image" | "video"): string {
  return type === "image" ? DEFAULT_IMAGE : DEFAULT_VIDEO;
}

export const MODELS: ModelDef[] = [
  {
    canonical: "gpt-image-2-6/flare-text-to-image",
    aliases: ["gpt-image-2-6/flare-text-to-image", "gpt-image-2.6/flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    // cometapi: اسم بنقاط وبشرات فقط (متوافق مع تسميتهم في نقطة images)
    providerModel: { kie: DEFAULT_IMAGE, cometapi: COMETAPI_IMAGE },
  },
  {
    canonical: "grok-imagine-video-1-5-preview",
    aliases: ["grok-imagine-video-1-5-preview", "grok-imagine-video-1.5-preview"],
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: { kie: DEFAULT_VIDEO, cometapi: COMETAPI_VIDEO },
  },
];

/** توحيد اسم الموديل: أحرف صغيرة والنقاط تصبح شرطات (الشرطة المائلة تُحفظ) */
export function normalizeModelName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\./g, "-");
}

/** يجد الموديل المدمج من اسم قادم من العميل (أي صيغة) — null إن كان غير معروف */
export function resolveModel(name: string, expectedType?: MediaType): ModelDef | null {
  const n = normalizeModelName(name);
  for (const m of MODELS) {
    if (m.aliases.some((a) => normalizeModelName(a) === n)) {
      if (expectedType && m.type !== expectedType) return null;
      return m;
    }
  }
  return null;
}

/** نتيجة حل اسم الموديل المطلوب */
export type ModelResolution =
  | { ok: true; def: ModelDef }
  | { ok: false; reason: "invalid" | "wrong-type"; requested: string };

/**
 * حل اسم الموديل المطلوب بمرونة كاملة:
 *  - فارغ → الافتراضي للنوع المطلوب
 *  - مدمج (بأي صيغة) → تعريفه مع ترجمة أسماء المزودين
 *  - من نوع مخالف → رفض بـ wrong-type (موديل فيديو لطلب صور مثلًا)
 *  - أي اسم آخر صالح الصيغة → موديل مخصص يُمرَّر كما هو لكل المزودين (providers = ["*"])
 */
export function resolveModelFlexible(name: string, expectedType: "image" | "video"): ModelResolution {
  const raw = (name || "").trim() || defaultModelFor(expectedType);
  const knownAny = resolveModel(raw);
  if (knownAny) {
    if (knownAny.type !== expectedType) {
      return { ok: false, reason: "wrong-type", requested: raw };
    }
    return { ok: true, def: knownAny };
  }
  // موديل مخصص — فحص صيغة وقائي: أحرف لاتينية/أرقام/نقاط/شرطات/شرطة مائلة/نقطتان
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:\\-]{0,119}$/.test(raw)) {
    return { ok: false, reason: "invalid", requested: raw };
  }
  return {
    ok: true,
    def: { canonical: raw, aliases: [raw], type: expectedType, providers: ["*"], providerModel: {} },
  };
}

/** صيغة رسالة الموديلات المتاحة (للرد على الطلب الخاطئ) */
export function availableModelsText(): string {
  const builtins = MODELS.map((m) => `${m.canonical} (${m.type === "image" ? "صور" : "فيديو"})`).join("، ");
  return `${builtins}. ويُقبل أيضًا أي اسم موديل آخر يدعمه مزودك — يُمرَّر كما هو`;
}
