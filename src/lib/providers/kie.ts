/**
 * محول kie.ai — Jobs API الموحد (المزود الأساسي).
 * الأشكال المقاسة فعليًا بالمفاتيح الحقيقية (2026-11):
 *  - createTask: POST /api/v1/jobs/createTask → HTTP 200 مع {"code":200,"data":{"taskId":"..."}}
 *    ملاحظة مهمة: خطأ المفتاح يأتي بحالة HTTP 200 مع code داخلي 401 → نعتمد code الجسم دائمًا.
 *  - recordInfo: GET /api/v1/jobs/recordInfo?taskId= → {"code":200,"data":{"state":"waiting|queuing|generating|success|fail",
 *      "resultJson":"{\"resultUrls\":[\"...\"]}",  // نص JSON داخل JSON — يحتاج JSON.parse ثانيًا
 *      "failMsg":"...","failCode":...,"successFlag":0|1}}
 */
import { ProviderError, type CheckResult, type ProviderAdapter } from "../types";

const BASE = (process.env.KIE_API_BASE || "https://api.kie.ai").replace(/\/+$/, "");

/** نداء موحد: يرمي ProviderError بالحالة الداخلية (code) أو حالة HTTP عند تعذر التحليل */
async function kieFetch(path: string, key: string, init?: RequestInit & { timeoutMs?: number }): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
    });
  } catch (e) {
    // انقطاع شبكة/timeout → مؤقت
    throw new ProviderError(undefined, e instanceof Error ? `temporary: ${e.message}` : "temporary: network error");
  }
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const httpStatus = res.status;
  const innerCode = typeof body?.code === "number" ? body.code : undefined;
  const msg = (typeof body?.msg === "string" && body.msg) || (typeof body?.message === "string" && body.message) || `HTTP ${httpStatus}`;

  // الجسم له code رقمي يغلب (kie يعيد 200 HTTP مع code=401 عند فشل التوثيق)
  const effective = innerCode ?? httpStatus;
  if (innerCode !== undefined && innerCode !== 200) {
    throw new ProviderError(effective, msg);
  }
  if (!res.ok) {
    throw new ProviderError(httpStatus, msg);
  }
  return (body?.data as Record<string, unknown>) ?? {};
}

export const kieAdapter: ProviderAdapter = {
  async createTask(key, providerModel, input) {
    const data = await kieFetch("/api/v1/jobs/createTask", key, {
      method: "POST",
      body: JSON.stringify({ model: providerModel, input }),
    });
    const taskId = typeof data.taskId === "string" ? data.taskId : undefined;
    if (!taskId) throw new ProviderError(undefined, "استجابة createTask بدون taskId");
    return { providerTaskId: taskId };
  },

  async checkTask(key, providerTaskId): Promise<CheckResult> {
    const data = await kieFetch(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`, key, { method: "GET" });
    const state = String(data.state ?? "").toLowerCase();

    if (state === "success" || data.successFlag === 1) {
      // resultJson نص JSON داخل JSON — يحتاج تحليلًا ثانيًا
      let urls: string[] = [];
      if (typeof data.resultJson === "string" && data.resultJson.trim()) {
        try {
          const parsed = JSON.parse(data.resultJson) as { resultUrls?: unknown };
          if (Array.isArray(parsed.resultUrls)) urls = parsed.resultUrls.filter((u): u is string => typeof u === "string");
        } catch {
          // تجاهل — نجرّب response أسفله
        }
      }
      if (urls.length === 0 && data.response && typeof data.response === "object") {
        const resp = data.response as { resultUrls?: unknown };
        if (Array.isArray(resp.resultUrls)) urls = resp.resultUrls.filter((u): u is string => typeof u === "string");
      }
      return { status: "completed", urls };
    }

    if (state === "fail" || state === "failed") {
      const failMsg = (typeof data.failMsg === "string" && data.failMsg) || (typeof data.failCode !== "undefined" ? `failCode ${String(data.failCode)}` : "فشل المزود دون رسالة");
      return { status: "failed", error: failMsg };
    }

    // waiting | queuing | generating → قيد المعالجة مع تقدير تقدم
    const rawProgress = Number(data.progress);
    const heuristic = state === "waiting" ? 8 : state === "queuing" ? 20 : 55;
    const progress = Number.isFinite(rawProgress) && rawProgress > 0 ? Math.min(99, Math.round(rawProgress)) : heuristic;
    return { status: "processing", progress };
  },
};
