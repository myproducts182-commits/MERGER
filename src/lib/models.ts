/**
 * سجل الموديلات — الأسماء الكانونية والبدائل والمزودون.
 * الاسم المرسل للعميل (canonical) موحد، ولكل مزود اسمه الخاص (providerModel) قابل للتجاوز بمتغيرات بيئة.
 * نقبل صيغًا بديلة بالنقاط ونوحّدها: gpt-image-2.6/... ↔ gpt-image-2-6/...
 */
import type { MediaType, ProviderId } from "./types";

export interface ModelDef {
  canonical: string;
  aliases: string[];
  type: MediaType;
  providers: ProviderId[];
  providerModel: Record<ProviderId, string>;
}

const KIE_IMAGE = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_IMAGE = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const COMETAPI_VIDEO = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";

export const MODELS: ModelDef[] = [
  {
    canonical: "gpt-image-2-6/flare-text-to-image",
    aliases: ["gpt-image-2-6/flare-text-to-image", "gpt-image-2.6/flare-text-to-image"],
    type: "image",
    providers: ["kie", "cometapi"],
    // cometapi: اسم بنقاط وبشرات فقط (متوافق مع تسميتهم في نقطة images)
    providerModel: { kie: KIE_IMAGE, cometapi: COMETAPI_IMAGE },
  },
  {
    canonical: "grok-imagine-video-1-5-preview",
    aliases: ["grok-imagine-video-1-5-preview", "grok-imagine-video-1.5-preview"],
    type: "video",
    providers: ["kie", "cometapi"],
    providerModel: { kie: KIE_VIDEO, cometapi: COMETAPI_VIDEO },
  },
];

/** توحيد اسم الموديل: أحرف صغيرة والنقاط تصبح شرطات (الشرطة المائلة تُحفظ) */
export function normalizeModelName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\./g, "-");
}

/** يجد الموديل الكانوني من اسم قادم من العميل (أي صيغة) — null إن كان غير معروف */
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

/** صيغة رسالة الموديلات المتاحة (للرد على الطلب الخاطئ) */
export function availableModelsText(): string {
  return MODELS.map((m) => `${m.canonical} (${m.type === "image" ? "صور" : "فيديو"})`).join("، ");
}
