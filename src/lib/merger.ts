/**
 * عميل خدمة دمج الفيديو — Video Merger API v2.
 * بلا مفاتيح أو توثيق؛ العنوان من MERGER_API_BASE. المخرجات MP4 (H.264 + AAC) حتى 1080p (CRF 18) —
 * لا معاملات resolution/fps، الناتج ثابت. الحدود: 10 مقاطع كحد أقصى، 200MB لكل مصدر، 150MB للناتج،
 * 600 ثانية مجموع المدد، وكل الملفات تُحذف تلقائيًا بعد 24 ساعة (expiresAt).
 *
 * قواعد دفاعية:
 *  - تحليل الحالة من مجموعة كلمات (done|completed|... / error|failed|...) لأن الحقول قد تتفاوت.
 *  - progress قد يرد كسرًا 0..1 → يُضرب في 100.
 *  - جسم فيه error بدون status → فشل فورًا.
 *  - أي خطأ HTTP معلن (4xx/5xx بجسم error) = فشل نهائي؛ أخطاء شبكتنا = مؤقتة.
 */
import { mergerBase } from "./env";
import { ProviderError, type CheckResult } from "./types";

export interface MergerJobCreated {
  jobId: string;
  status?: string;
  statusUrl?: string;
  processUrl?: string;
  expiresAt?: string;
}

export interface MergerStatus {
  status: "queued" | "processing" | "done" | "failed";
  progress: number;
  videoUrl?: string;
  downloadUrl?: string;
  error?: string;
  size?: number;
  duration?: number;
  resolution?: string;
  expiresAt?: string;
  jobId?: string;
}

async function mergerFetch(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Record<string, unknown>> {
  const base = mergerBase();
  if (!base) throw new ProviderError(undefined, "MERGER_NOT_CONFIGURED: خدمة الدمج غير مهيأة");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 70_000),
    });
  } catch (e) {
    // خطأ شبكتنا نحن → مؤقت (استمر بالاستعلام)
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
    // خطأ معلن من الخدمة = فشل نهائي (مثل مصدر يرفض التحميل)
    throw new ProviderError(res.status, (typeof body?.error === "string" && body.error) || text?.slice(0, 300) || `HTTP ${res.status}`);
  }
  return body ?? {};
}

/** POST /api/jobs — إنشاء مهمة دمج */
export async function mergerCreateJob(videos: string[]): Promise<MergerJobCreated> {
  const body = await mergerFetch("/api/jobs", { method: "POST", body: JSON.stringify({ videos }) });
  const jobId = (typeof body.jobId === "string" && body.jobId) || (typeof body.id === "string" && body.id) || undefined;
  if (!jobId) throw new ProviderError(undefined, "استجابة إنشاء مهمة الدمج بدون jobId");
  return {
    jobId,
    status: typeof body.status === "string" ? body.status : undefined,
    statusUrl: typeof body.statusUrl === "string" ? body.statusUrl : undefined,
    processUrl: typeof body.processUrl === "string" ? body.processUrl : undefined,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
  };
}

/** POST /api/jobs/{id}/process — يستغرق ~10–15 ثانية (blocking) */
export async function mergerProcessJob(jobId: string): Promise<void> {
  await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}/process`, { method: "POST", timeoutMs: 90_000 });
}

/** GET /api/jobs/{id} — تحليل دفاعي للحالة */
export async function mergerGetStatus(jobId: string): Promise<MergerStatus> {
  let body: Record<string, unknown>;
  try {
    body = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET", timeoutMs: 15_000 });
  } catch (e) {
    // 404 → المهمة حُذفت أو انتهت صلاحيتها (بعد 24 ساعة) → فشل نهائي
    if (e instanceof ProviderError && e.status === 404) throw e;
    if (e instanceof ProviderError && e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
    throw e; // 5xx/شبكة → مؤقت (يتولى المنسّق قرار الانتظار)
  }

  const s = String(body.status ?? "").toLowerCase();
  const DONE = ["done", "completed", "complete", "success", "succeeded", "finished"];
  const FAIL = ["error", "failed", "failure", "cancelled", "canceled"];

  // جسم فيه error بدون status → فشل فورًا
  const hasErrorNoStatus = !body.status && typeof body.error === "string" && body.error;
  let status: MergerStatus["status"] = "processing";
  if (DONE.includes(s)) status = "done";
  else if (FAIL.includes(s) || hasErrorNoStatus) status = "failed";

  // progress كسر 0..1 → ×100 (القيم الصحيحة تبقى كما هي)
  let progress = Number(body.progress ?? 0);
  if (Number.isFinite(progress) && progress > 0 && progress < 1) progress = progress * 100;
  progress = Math.max(0, Math.min(100, Math.round(Number.isFinite(progress) ? progress : 0)));
  if (status === "done") progress = 100;

  const videoUrl = typeof body.videoUrl === "string" && body.videoUrl ? body.videoUrl : undefined;
  const downloadUrl = typeof body.downloadUrl === "string" && body.downloadUrl ? body.downloadUrl : undefined;

  return {
    status,
    progress,
    videoUrl,
    downloadUrl,
    error: typeof body.error === "string" ? body.error : undefined,
    size: typeof body.size === "number" ? body.size : undefined,
    duration: typeof body.duration === "number" ? body.duration : undefined,
    resolution: typeof body.resolution === "string" ? body.resolution : undefined,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    jobId,
  };
}

/** رابط النتيجة الاحتياطي عند غياب videoUrl/downloadUrl */
export function mergerFallbackVideoUrl(jobId: string): string {
  return `${mergerBase()}/api/jobs/${encodeURIComponent(jobId)}/video`;
}

/** DELETE /api/jobs/{id} — حذف فوري (تنظيف اختياري) */
export async function mergerDeleteJob(jobId: string): Promise<boolean> {
  try {
    await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** GET /api/config — حدود الخدمة الحالية (لفحص الجهوزية في /api/health بمهلة 4 ثوانٍ) */
export async function mergerHealthy(): Promise<boolean> {
  const base = mergerBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(4_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** فحص سريع لمهمة الدمج كمصطلح CheckResult موحد لاستخدامه في refreshMergeTask */
export function mergerStatusToCheck(st: MergerStatus, jobId: string): CheckResult {
  if (st.status === "done") {
    const url = st.videoUrl ?? st.downloadUrl ?? mergerFallbackVideoUrl(jobId);
    return { status: "completed", urls: [url], progress: 100 };
  }
  if (st.status === "failed") {
    return { status: "failed", error: st.error || "فشلت خدمة الدمج دون رسالة" };
  }
  return { status: "processing", progress: st.progress };
}
