/**
 * محول CometAPI (المزود الثاني) — وفق توثيق apidoc.cometapi.com الحالي:
 *  - الصور: نقطة OpenAI-المتوافقة المتزامنة POST /v1/images/generations → {"created":...,"data":[{"url"| "b64_json"}]}
 *  - الفيديو: غير متزامن بنمط OpenAI Sora: POST /v1/videos → {"id":"task_...","status":"queued","progress":0}
 *              ثم GET /v1/videos/{id} حتى completed مع رابط/محتوى النتيجة.
 * ملاحظة: لا نعتمد b64_json (قاعدة: لا تنزيل وسائط على سيرفرنا) — غياب الرابط يعامل كفشل مؤقت ليُجرّب المزود/المفتاح التالي.
 */
import { ProviderError, type CheckResult, type ProviderAdapter } from "../types";

const BASE = (process.env.COMETAPI_API_BASE || "https://api.cometapi.com").replace(/\/+$/, "");

async function cometFetch(path: string, key: string, init?: RequestInit & { timeoutMs?: number }): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 45_000),
    });
  } catch (e) {
    throw new ProviderError(undefined, e instanceof Error ? `temporary: ${e.message}` : "temporary: network error");
  }
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (!res.ok) {
    // استخراج دفاعي لرسالة الخطأ (نص/كائن {message}) مع تجاهل b64 (لا نطبع المفتاح أبدًا)
    let msg = "";
    if (body) {
      if (typeof body.error === "string" && body.error) msg = body.error;
      else if (body.error && typeof body.error === "object") {
        const m = (body.error as Record<string, unknown>).message;
        if (typeof m === "string" && m) msg = m;
      }
      if (!msg && typeof body.message === "string" && body.message) msg = body.message;
    }
    throw new ProviderError(res.status, msg || text?.slice(0, 300) || `HTTP ${res.status}`);
  }
  return body ?? {};
}

export const cometApiAdapter: ProviderAdapter = {
  async createImageSync(key, providerModel, input) {
    const body = await cometFetch("/v1/images/generations", key, {
      method: "POST",
      body: JSON.stringify({
        model: providerModel,
        prompt: input.prompt,
        ...(input.aspect_ratio && input.aspect_ratio !== "auto" ? { aspect_ratio: input.aspect_ratio } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
      }),
    });
    const arr = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
    const urls = arr.map((d) => (typeof d.url === "string" ? d.url : null)).filter((u): u is string => !!u);
    if (urls.length === 0) {
      // أعاد b64_json فقط أو شكلًا غير متوقع — نرمي مؤقتًا ليُجرّب المفتاح/المزود التالي (لا نخزّن وسائط)
      throw new ProviderError(undefined, "temporary: مزود CometAPI لم يعيد رابطًا مباشرًا للصورة");
    }
    return { urls };
  },

  async createTask(key, providerModel, input) {
    const body = await cometFetch("/v1/videos", key, {
      method: "POST",
      body: JSON.stringify({
        model: providerModel,
        prompt: input.prompt,
        ...(input.image_url ? { input_reference: [input.image_url] } : {}),
        ...(input.duration ? { seconds: input.duration } : {}),
        ...(input.aspect_ratio && input.aspect_ratio !== "auto" ? { size: input.aspect_ratio } : {}),
      }),
    });
    const id = (typeof body.id === "string" && body.id) || (typeof body.task_id === "string" && body.task_id) || undefined;
    if (!id) throw new ProviderError(undefined, "استجابة إنشاء فيديو CometAPI بدون معرّف");
    return { providerTaskId: id };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const body = await cometFetch(`/v1/videos/${encodeURIComponent(providerTaskId)}`, key, { method: "GET" });
    const status = String(body.status ?? "").toLowerCase();

    if (["completed", "complete", "success", "succeeded"].includes(status)) {
      const urls: string[] = [];
      for (const k of ["url", "video_url", "videoUrl", "download_url", "downloadUrl"]) {
        const v = body[k];
        if (typeof v === "string" && /^https?:\/\//i.test(v)) urls.push(v);
      }
      if (urls.length === 0 && typeof body.id === "string") {
        // نمط Sora: المحتوى يُجلب من نقطة المحتوى المباشرة العامة
        urls.push(`${BASE}/v1/videos/${body.id}/content`);
      }
      return { status: "completed", urls };
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      const err = typeof body.error === "object" && body.error !== null ? String((body.error as Record<string, unknown>).message ?? "فشل المزود") : String(body.error ?? "فشل المزود");
      return { status: "failed", error: err };
    }
    const p = Number(body.progress);
    return {
      status: "processing",
      progress: Number.isFinite(p) && p > 0 ? Math.min(99, p <= 1 ? Math.round(p * 100) : Math.round(p)) : undefined,
    };
  },
};
