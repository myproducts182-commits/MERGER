/**
 * سجل المحولات — نقطة واحدة لاختيار محول أي مزود.
 * المزودات المعروفة (kie/cometapi) بمحولاتها، وأي مزود مخصص يُدار بحسب نمط التوافق
 * المختار مع مفتاحه: «kie» (Jobs API — الافتراضي) أو «openai» (Images/Videos).
 */
import type { ProviderAdapter } from "../types";
import { kieAdapter } from "./kie";
import { cometApiAdapter } from "./cometapi";

interface AdapterKeyLike {
  provider: string;
  base_url?: string | null;
  api_style?: "kie" | "openai" | null;
}

/** يختار المحول المناسب للمفتاح — المزودات المخصصة تتبع نمط التوافق المخزن مع مفتاحها */
export function adapterForKey(key: AdapterKeyLike): ProviderAdapter {
  const p = (key.provider || "").toLowerCase();
  if (key.api_style === "openai") return cometApiAdapter;
  if (p.includes("comet")) return cometApiAdapter;
  // kie وأي مزود مخصص بنمط «kie» (الافتراضي) — نمط Jobs API الموحد
  return kieAdapter;
}

/** محولات المزودين المعروفين (للاستخدام المباشر عند الحاجة) */
export const ADAPTERS = {
  kie: kieAdapter,
  cometapi: cometApiAdapter,
} as const;
