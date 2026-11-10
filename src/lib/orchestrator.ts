/**
 * منسّق التوليد — runGeneration / refreshTask / runMerge / refreshMergeTask.
 *
 * سياسة التبديل «لا توقف أبدًا»:
 *  1) الإنشاء: تجربة المرشحين بالترتيب التسلسلي الصارم؛ أول نجاح يربط المهمة بالمزود والمفتاح،
 *     وكل محاولة (نجاح/فشل + فئتها) تُسجَّل في attempts_json وعدّادات المفتاح تُحدَّث دائمًا.
 *  2) فشل في منتصف المهمة برسالة تطابق مشكلات مفتاح/رصيد → إعادة إنشاء نفس المهمة بنفس task_id
 *     على المفتاح التالي تلقائيًا (قد يكون بمزود مختلف) ومتابعة الاستعلام.
 *  3) فشل الإنشاء على كل المفاتيح → المهمة تبقى processing (وليست failed) برسالة داخلية
 *     «بانتظار توفر مفتاح صالح…» وتُعاد المحاولة مع كل get_task بعد تهدئة ~45 ثانية.
 *  4) نموذج الذكاء الاصطناعي لا يرى أخطاء مفاتيح/رصيد أبدًا — لا شيء يخرج للعميل يحويها.
 */
import { resolveModel, availableModelsText, type ModelDef } from "./models";
import { getKeyPool, getKeyById, classifyProviderError, isKeyOrBalancePattern, updateKeyCounters } from "./keys";
import { insertTask, getTask, updateTask, type TaskPatch } from "./tasks";
import { ADAPTERS } from "./providers";
import {
  mergerCreateJob,
  mergerProcessJob,
  mergerGetStatus,
  mergerFallbackVideoUrl,
} from "./merger";
import { ProviderError, type AttemptRecord, type KeyRecord, type MediaType, type ProviderId, type TaskRecord } from "./types";
import { maxEffectiveWaitSeconds, mergerBase } from "./env";

/** نتيجة أداة MCP بصياغة عربية */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const POLL_INTERVAL_MS = 3_000; // استعلام كل 3 ثوانٍ أثناء نافذة الانتظار
const RETRY_COOLDOWN_MS = 45_000; // تهدئة قبل إعادة محاولة الإنشاء على كل المفاتيح
const DEFAULT_WAIT: Record<"image" | "video" | "merge", number> = { image: 90, video: 25, merge: 60 };

/** قفل تنفيذ خطوة process لخدمة الدمج في الذاكرة (يمنع التزامن مع get_task) */
const processInFlight: Set<string> = ((globalThis as Record<string, unknown>).__mergeProcessInFlight as Set<string>) ?? new Set<string>();
(globalThis as Record<string, unknown>).__mergeProcessInFlight = processInFlight;

function failResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function okResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function attempt(provider: string, key: KeyRecord | null, ok: boolean, errorClass?: AttemptRecord["errorClass"], error?: string): AttemptRecord {
  return {
    provider,
    keyId: key?.id ?? "",
    keyLabel: key?.label || key?.id.slice(0, 8) || "",
    ok,
    errorClass,
    error: error?.slice(0, 300),
    at: new Date().toISOString(),
  };
}

/** نافذة الانتظار الفعلية: المعطى مقيّد بالحد الأقصى لحماية دوال serverless */
function effectiveWaitSeconds(requested: unknown, type: "image" | "video" | "merge"): number {
  const req = typeof requested === "number" && Number.isFinite(requested) ? requested : DEFAULT_WAIT[type];
  return Math.max(0, Math.min(req, maxEffectiveWaitSeconds()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ————————— صياغة الردود العربية ————————— */

export function completedResultText(type: MediaType, urls: string[]): string {
  const links = urls.join("\n");
  const direct = `الرابط المباشر: ${urls[0]}`;
  if (type === "image") {
    return `✅ تم توليد الصورة بنجاح\n\n![image](${urls[0]})\n\n${direct}${urls.length > 1 ? `\n\nروابط إضافية:\n${links}` : ""}`;
  }
  if (type === "merge") {
    return `✅ تم دمج المقاطع بنجاح\n\n${direct}${urls.length > 1 ? `\n\nروابط إضافية:\n${links}` : ""}\n\n⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.`;
  }
  return `✅ تم توليد الفيديو بنجاح\n\n${direct}${urls.length > 1 ? `\n\nروابط إضافية:\n${links}` : ""}`;
}

export function processingResultText(taskId: string, progress?: number): string {
  const p = typeof progress === "number" && progress > 0 ? ` (التقدم الحالي ~${Math.round(progress)}%)` : "";
  return `⏳ المهمة قيد المعالجة${p} — task_id: ${taskId}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.`;
}

function completedResult(type: MediaType, urls: string[]): ToolResult {
  return okResult(completedResultText(type, urls));
}

/* ————————— الإنشاء على مجمّع المفاتيح بالترتيب ————————— */

interface CreateOutcome {
  ok: boolean;
  provider?: ProviderId;
  key?: KeyRecord;
  providerTaskId?: string;
  /** صور متزامنة: روابط فورية تعني اكتمال المهمة في الحال */
  immediateUrls?: string[];
  /** خطأ معطيات حقيقي → فشل نهائي للمهمة (لا فائدة من تبديل المفاتيح) */
  paramsError?: string;
  /** آخر رسالة خطأ (داخلية فقط) */
  lastError?: string;
}

/**
 * جرّب المرشحين بالترتيب بدءًا من startIndex حتى أول نجاح.
 * - يحدّث عدّادات كل مفتاح وسجل المحاولات دائمًا.
 * - خطأ params → يوقف كل شيء (فشل نهائي).
 * - غير ذلك (disabled/exhausted/provider/temporary) → انتقل للمفتاح التالي بصمت.
 */
async function tryCreateOnPool(opts: {
  taskId: string;
  modelDef: ModelDef;
  pool: KeyRecord[];
  startIndex: number;
  input: Record<string, unknown>;
  taskType: "image" | "video";
}): Promise<CreateOutcome> {
  let lastError = "";
  for (let i = opts.startIndex; i < opts.pool.length; i++) {
    const key = opts.pool[i];
    const provider = key.provider as ProviderId;
    const adapter = ADAPTERS[provider];
    const providerModel = opts.modelDef.providerModel[provider];
    try {
      if (opts.taskType === "image" && adapter.createImageSync) {
        const { urls } = await adapter.createImageSync(key.api_key, providerModel, opts.input);
        await updateKeyCounters(key, { ok: true });
        await updateTask(opts.taskId, { append_attempt: attempt(provider, key, true) });
        return { ok: true, provider, key, immediateUrls: urls };
      }
      const { providerTaskId } = await adapter.createTask(key.api_key, providerModel, opts.input);
      await updateKeyCounters(key, { ok: true });
      await updateTask(opts.taskId, { append_attempt: attempt(provider, key, true) });
      return { ok: true, provider, key, providerTaskId };
    } catch (err) {
      const cls = classifyProviderError(err);
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      await updateKeyCounters(key, { ok: false, errorClass: cls, error: msg });
      await updateTask(opts.taskId, { append_attempt: attempt(provider, key, false, cls, msg) });
      if (cls === "params") {
        // خطأ معطيات — التوقف فورًا: تبديل المفاتيح لن يحل خطأ معطيات
        return { ok: false, paramsError: msg };
      }
      // disabled/exhausted/provider/temporary → التالي بصمت
    }
  }
  return { ok: false, lastError };
}

/** رسالة الفشل الآمنة للعميل عند خطأ معطيات (بلا أي ذكر لمفاتيح) */
function paramsFailText(type: string, msg: string): string {
  return `❌ فشلت المهمة: رفض المزود معطيات الطلب (${type}). تحقق من الوصف والمعطيات ثم أعد المحاولة.\n\nالتفاصيل: ${msg.slice(0, 300)}`;
}

/* ————————— حلقة الاستعلام عن مهمة توليد جارية ————————— */

interface PollState {
  provider: ProviderId;
  key: KeyRecord;
  providerTaskId: string;
}

/** خطوة استعلام واحدة لمهمة توليد — تعيد patch أو تُدير التبديل داخليًا */
async function pollGenerationTask(taskId: string, modelDef: ModelDef, state: PollState): Promise<
  | { kind: "completed"; urls: string[] }
  | { kind: "failed"; error: string }
  | { kind: "processing"; progress?: number; patch: TaskPatch }
  | { kind: "switched"; patch: TaskPatch }
  | { kind: "waiting-for-key" }
> {
  const adapter = ADAPTERS[state.provider];
  try {
    const st = await adapter.checkTask(state.key.api_key, state.providerTaskId);
    if (st.status === "completed" && st.urls && st.urls.length > 0) {
      return { kind: "completed", urls: st.urls };
    }
    if (st.status === "completed") {
      return { kind: "failed", error: "أعلن المزود الاكتمال دون روابط نتائج" };
    }
    if (st.status === "failed") {
      const errText = st.error || "فشل المزود دون رسالة";
      // فشل في منتصف المهمة يطابق نمط مفتاح/رصيد → علّم المفتاح وأعد الإنشاء على التالي بنفس task_id
      if (isKeyOrBalancePattern(errText)) {
        const cls = classifyProviderError(new ProviderError(/402/.test(errText) ? 402 : undefined, errText));
        await updateKeyCounters(state.key, { ok: false, errorClass: cls, error: errText });
        await updateTask(taskId, { append_attempt: attempt(state.provider, state.key, false, cls, errText) });
        return await switchToNextKey(taskId, modelDef, state.key.id);
      }
      return { kind: "failed", error: errText };
    }
    // قيد المعالجة — تحديث حي في القاعدة
    return { kind: "processing", progress: st.progress, patch: { progress: st.progress ?? 0 } };
  } catch (err) {
    const cls = classifyProviderError(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (cls === "temporary" || cls === "params") {
      // مؤقت أثناء الاستعلام → نستمر بالاستعلام حتى انتهاء النافذة (params نظريًا لا يظهر هنا)
      return { kind: "processing", patch: {} };
    }
    // المفتاح أصبح غير صالح/مستنزف أثناء الاستعلام → علّمه وبدّل
    await updateKeyCounters(state.key, { ok: false, errorClass: cls, error: msg });
    await updateTask(taskId, { append_attempt: attempt(state.provider, state.key, false, cls, msg) });
    return await switchToNextKey(taskId, modelDef, state.key.id);
  }
}

/** إعادة إنشاء نفس المهمة (نفس task_id) على المفاتيح التالية في الترتيب */
async function switchToNextKey(taskId: string, modelDef: ModelDef, failedKeyId: string): Promise<
  | { kind: "switched"; patch: TaskPatch }
  | { kind: "waiting-for-key" }
> {
  const pool = await getKeyPool(modelDef.providers);
  const idx = pool.findIndex((k) => k.id === failedKeyId);
  const startIndex = idx >= 0 ? idx + 1 : 0;
  const task = await getTask(taskId);
  const input = (task?.params ?? {}) as Record<string, unknown>;
  const outcome = await tryCreateOnPool({
    taskId,
    modelDef,
    pool,
    startIndex,
    input,
    taskType: modelDef.type === "image" ? "image" : "video",
  });
  if (outcome.ok && outcome.provider && outcome.key) {
    const patch: TaskPatch = {
      provider: outcome.provider,
      provider_task_id: outcome.providerTaskId ?? null,
      key_id: outcome.key.id,
      error_message: null,
    };
    return { kind: "switched", patch };
  }
  // لا مفاتيح متبقية — تبقى المهمة processing بانتظار مفتاح صالح
  await updateTask(taskId, { error_message: "بانتظار توفر مفتاح صالح…" });
  return { kind: "waiting-for-key" };
}

/* ————————— الأداة الرئيسية: runGeneration ————————— */

export async function runGeneration(opts: {
  type: "image" | "video";
  args: Record<string, unknown>;
  /** بث تقدم حي عبر progress notifications (إن زوّد العميل الطلب بـ progressToken) */
  sendProgress?: (progress: number, message: string) => Promise<void>;
}): Promise<ToolResult> {
  const args = opts.args;
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) {
    return failResult("❌ الحقل prompt مطلوب: اكتب وصفًا لما تريد توليده.");
  }

  // 1) توحيد اسم الموديل — غير معروف → خطأ معطيات فوري
  const modelDef = resolveModel(String(args.model ?? (opts.type === "image" ? "gpt-image-2-6/flare-text-to-image" : "grok-imagine-video-1-5-preview")), opts.type);
  if (!modelDef) {
    const modelStr = String(args.model ?? "");
    return failResult(`❌ موديل غير معروف: ${modelStr || "(فارغ)"}.\nالمتاح: ${availableModelsText()}`);
  }

  // 2) مجمّع المفاتيح — فارغ → رد no_keys (حالة إعداد تُذكر للعميل حرفيًا)
  const pool = await getKeyPool(modelDef.providers);
  if (pool.length === 0) {
    return failResult(`❌ لا توجد مفاتيح نشطة لخدمة ${modelDef.canonical}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`);
  }

  // 3) بناء المعطيات الأصلية (تُخزن كاملة لإعادة الإنشاء عند التبديل)
  const input: Record<string, unknown> = { prompt };
  if (typeof args.image_url === "string" && args.image_url) input.image_url = args.image_url;
  if (typeof args.aspect_ratio === "string" && args.aspect_ratio && args.aspect_ratio !== "auto") input.aspect_ratio = args.aspect_ratio;
  if (typeof args.resolution === "string" && args.resolution) input.resolution = args.resolution;
  if (typeof args.background === "string" && args.background && args.background !== "auto") input.background = args.background;
  if (typeof args.output_format === "string" && args.output_format) input.output_format = args.output_format;
  if (typeof args.enable_audio === "boolean") input.enable_audio = args.enable_audio;
  if (typeof args.duration === "number" && Number.isFinite(args.duration)) input.duration = args.duration;
  const storedParams = { ...input, wait_seconds: args.wait_seconds };

  // سجّل المهمة في Turso قبل أي نداء خارجي — تبقى قابلة للتتبع حتى لو انقطع الاتصال
  const taskId = crypto.randomUUID();
  await insertTask({
    id: taskId,
    type: opts.type,
    model: modelDef.canonical,
    prompt,
    params_json: JSON.stringify(storedParams),
    status: "processing",
  });

  // 4) الإنشاء على المرشحين بالترتيب
  const outcome = await tryCreateOnPool({
    taskId,
    modelDef,
    pool,
    startIndex: 0,
    input,
    taskType: opts.type,
  });

  if (!outcome.ok) {
    if (outcome.paramsError) {
      await updateTask(taskId, { status: "failed", error_message: outcome.paramsError, progress: 0 });
      return failResult(paramsFailText(opts.type, outcome.paramsError));
    }
    // فشل على كل المفاتيح → تبقى processing (ليست failed) وتُعاد مع كل get_task بعد تهدئة
    await updateTask(taskId, { error_message: "بانتظار توفر مفتاح صالح…" });
    return okResult(processingResultText(taskId));
  }

  // صور متزامنة (المزود أعاد الروابط فورًا) → اكتمال في الحال
  if (outcome.immediateUrls && outcome.immediateUrls.length > 0) {
    await updateTask(taskId, {
      status: "completed",
      progress: 100,
      provider: outcome.provider,
      key_id: outcome.key?.id,
      result_urls: outcome.immediateUrls,
    });
    return completedResult(opts.type, outcome.immediateUrls);
  }

  await updateTask(taskId, {
    provider: outcome.provider,
    provider_task_id: outcome.providerTaskId ?? null,
    key_id: outcome.key?.id,
  });

  // 5) نافذة الانتظار: استعلام كل 3 ثوانٍ مع بث تقدم حي
  const waitSeconds = effectiveWaitSeconds(args.wait_seconds, opts.type);
  const deadline = Date.now() + waitSeconds * 1_000;
  let state: PollState | null = outcome.provider && outcome.key && outcome.providerTaskId
    ? { provider: outcome.provider, key: outcome.key, providerTaskId: outcome.providerTaskId }
    : null;

  while (state && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await pollGenerationTask(taskId, modelDef, state);

    if (res.kind === "completed") {
      await updateTask(taskId, { status: "completed", progress: 100, result_urls: res.urls, error_message: null });
      return completedResult(opts.type, res.urls);
    }
    if (res.kind === "failed") {
      await updateTask(taskId, { status: "failed", error_message: res.error });
      return failResult(`❌ فشلت المهمة: ${res.error}`);
    }
    if (res.kind === "processing") {
      const progress = res.progress;
      await updateTask(taskId, { progress: progress ?? undefined, ...res.patch });
      if (opts.sendProgress) {
        try {
          await opts.sendProgress(progress ?? 0, `قيد التوليد… ${Math.round(progress ?? 0)}%`);
        } catch {
          // فشل بث التقدم لا يوقف المهمة أبدًا
        }
      }
      continue;
    }
    if (res.kind === "switched") {
      // استؤنفت نفس المهمة على مفتاح آخر — حدّث الحالة وتابع الاستعلام بنفس task_id
      await updateTask(taskId, res.patch);
      const t = await getTask(taskId);
      if (t && t.provider && t.provider_task_id && t.key_id) {
        const k = await getKeyById(t.key_id);
        if (k) {
          state = { provider: t.provider as ProviderId, key: k, providerTaskId: t.provider_task_id };
          continue;
        }
      }
      state = null;
      break;
    }
    if (res.kind === "waiting-for-key") {
      return okResult(processingResultText(taskId));
    }
  }

  // 7) انتهت النافذة والنتيجة لم تظهر → أعد المهمة بحالتها الحالية والعميل يتابع بـ get_task
  const t = await getTask(taskId);
  return okResult(processingResultText(taskId, t?.progress ?? 0));
}

/* ————————— get_task: تحديث حي من المزود/الخدمة ————————— */

export async function refreshTask(taskId: string): Promise<ToolResult> {
  const task = await getTask(taskId);
  if (!task) {
    return failResult(`❌ لا توجد مهمة بهذا المعرّف: ${taskId}. تحقق من task_id أو استخدم list_media لاستعراض المهام المخزنة.`);
  }

  if (task.status === "completed") {
    if (task.result_urls.length === 0) {
      return failResult(`❌ المهمة مكتملة لكن لا روابط مخزنة لها (${task.id}).`);
    }
    return completedResult(task.type, task.result_urls);
  }
  if (task.status === "failed") {
    return failResult(`❌ فشلت المهمة: ${task.error_message || "سبب غير معروف"}`);
  }

  // مهمة دمج → مسار خاص
  if (task.type === "merge" || task.provider === "merger") {
    return refreshMergeTask(task);
  }

  const modelDef = resolveModel(task.model);
  if (!modelDef) {
    return failResult(`❌ فشلت المهمة: موديل غير معروف في السجل (${task.model})`);
  }

  // مهمة جارية لم تنشأ بعد على أي مزود → أعد المحاولة على كل المفاتيح (بتهدئة ~45 ثانية)
  if (!task.provider || !task.provider_task_id || !task.key_id) {
    const lastAt = task.attempts.length > 0 ? Date.parse(task.attempts[task.attempts.length - 1].at) : 0;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < RETRY_COOLDOWN_MS) {
      return okResult(processingResultText(task.id, task.progress));
    }
    const pool = await getKeyPool(modelDef.providers);
    if (pool.length === 0) {
      return okResult(processingResultText(task.id, task.progress));
    }
    const input = (task.params ?? {}) as Record<string, unknown>;
    const outcome = await tryCreateOnPool({
      taskId: task.id,
      modelDef,
      pool,
      startIndex: 0,
      input,
      taskType: task.type === "image" ? "image" : "video",
    });
    if (!outcome.ok) {
      // ما زلنا بانتظار مفتاح صالح — المهمة تبقى processing (العميل لا يرى تفاصيل المفاتيح)
      return okResult(processingResultText(task.id, task.progress));
    }
    if (outcome.immediateUrls && outcome.immediateUrls.length > 0) {
      await updateTask(task.id, {
        status: "completed",
        progress: 100,
        provider: outcome.provider,
        key_id: outcome.key?.id,
        result_urls: outcome.immediateUrls,
      });
      return completedResult(task.type, outcome.immediateUrls);
    }
    await updateTask(task.id, {
      provider: outcome.provider,
      provider_task_id: outcome.providerTaskId ?? null,
      key_id: outcome.key?.id,
      error_message: null,
    });
    if (outcome.provider && outcome.key && outcome.providerTaskId) {
      const res = await pollGenerationTask(task.id, modelDef, {
        provider: outcome.provider,
        key: outcome.key,
        providerTaskId: outcome.providerTaskId,
      });
      if (res.kind === "completed") {
        await updateTask(task.id, { status: "completed", progress: 100, result_urls: res.urls, error_message: null });
        return completedResult(task.type, res.urls);
      }
      if (res.kind === "failed") {
        await updateTask(task.id, { status: "failed", error_message: res.error });
        return failResult(`❌ فشلت المهمة: ${res.error}`);
      }
    }
    return okResult(processingResultText(task.id));
  }

  // مهمة جارية عند مزود — تحديث حي مع نفس منطق التبديل
  const key = await getKeyById(task.key_id);
  if (!key) {
    // المفتاح حُذف يدويًا — أعد الإنشاء على المجمّع كاملًا
    const sw = await switchToNextKey(task.id, modelDef, task.key_id);
    if (sw.kind === "switched") {
      await updateTask(task.id, sw.patch);
      const t2 = await getTask(task.id);
      if (t2 && t2.provider && t2.provider_task_id && t2.key_id) {
        const k2 = await getKeyById(t2.key_id);
        if (k2) {
          const res = await pollGenerationTask(task.id, modelDef, { provider: t2.provider as ProviderId, key: k2, providerTaskId: t2.provider_task_id });
          if (res.kind === "completed") {
            await updateTask(task.id, { status: "completed", progress: 100, result_urls: res.urls, error_message: null });
            return completedResult(task.type, res.urls);
          }
          if (res.kind === "failed") {
            await updateTask(task.id, { status: "failed", error_message: res.error });
            return failResult(`❌ فشلت المهمة: ${res.error}`);
          }
        }
      }
      return okResult(processingResultText(task.id));
    }
    return okResult(processingResultText(task.id, task.progress));
  }

  const res = await pollGenerationTask(task.id, modelDef, {
    provider: task.provider as ProviderId,
    key,
    providerTaskId: task.provider_task_id,
  });

  if (res.kind === "completed") {
    await updateTask(task.id, { status: "completed", progress: 100, result_urls: res.urls, error_message: null });
    return completedResult(task.type, res.urls);
  }
  if (res.kind === "failed") {
    await updateTask(task.id, { status: "failed", error_message: res.error });
    return failResult(`❌ فشلت المهمة: ${res.error}`);
  }
  if (res.kind === "processing") {
    await updateTask(task.id, { progress: res.progress ?? undefined, ...res.patch });
    return okResult(processingResultText(task.id, res.progress ?? task.progress));
  }
  if (res.kind === "switched") {
    await updateTask(task.id, res.patch);
    const t2 = await getTask(task.id);
    if (t2 && t2.provider && t2.provider_task_id && t2.key_id) {
      const k2 = await getKeyById(t2.key_id);
      if (k2) {
        const res2 = await pollGenerationTask(task.id, modelDef, { provider: t2.provider as ProviderId, key: k2, providerTaskId: t2.provider_task_id });
        if (res2.kind === "completed") {
          await updateTask(task.id, { status: "completed", progress: 100, result_urls: res2.urls, error_message: null });
          return completedResult(task.type, res2.urls);
        }
        if (res2.kind === "failed") {
          await updateTask(task.id, { status: "failed", error_message: res2.error });
          return failResult(`❌ فشلت المهمة: ${res2.error}`);
        }
        if (res2.kind === "processing") {
          await updateTask(task.id, { progress: res2.progress ?? undefined, ...res2.patch });
          return okResult(processingResultText(task.id, res2.progress ?? 0));
        }
      }
    }
    return okResult(processingResultText(task.id));
  }
  return okResult(processingResultText(task.id, task.progress));
}

/* ————————— دمج الفيديو: runMerge + refreshMergeTask ————————— */

/** إطلاق خطوة process مرة واحدة فقط لكل مهمة دمج (قفل بالذاكرة + علم محفوظ في params) */
async function ensureProcessKicked(task: TaskRecord): Promise<void> {
  const jobId = task.provider_task_id;
  if (!jobId) return;
  const params = (task.params ?? {}) as Record<string, unknown>;
  if (params.processStarted === true) return; // أُطلق سابقًا (محفوظ في القاعدة)
  if (processInFlight.has(jobId)) return; // جارٍ الآن
  processInFlight.add(jobId);
  // علّمه محفوظًا أولًا حتى لو أعيد تشغيل العملية
  await queryMarkProcessStarted(task.id);
  // خلفيًا ومرة واحدة فقط — النتيجة تُلتقط عبر الاستعلام الدوري
  void mergerProcessJob(jobId)
    .catch(() => {
      // فشل process يظهر عند الاستعلام (الخدمة تعلن الحالة/الخطأ)
    })
    .finally(() => processInFlight.delete(jobId));
}

async function queryMarkProcessStarted(taskId: string): Promise<void> {
  const { query } = await import("./turso");
  const row = await query("SELECT params_json FROM tasks WHERE id = ?", [taskId]);
  const raw = String(row.rows[0]?.params_json ?? "{}");
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    params = {};
  }
  params.processStarted = true;
  await query("UPDATE tasks SET params_json = ? WHERE id = ?", [JSON.stringify(params), taskId]);
}

export async function runMerge(opts: {
  args: Record<string, unknown>;
  sendProgress?: (progress: number, message: string) => Promise<void>;
}): Promise<ToolResult> {
  const args = opts.args;

  // خدمة الدمج مهيأة؟
  if (!mergerBase()) {
    return failResult("❌ خدمة الدمج غير مهيأة على السيرفر — عيّن متغير البيئة MERGER_API_BASE ثم أعد المحاولة.");
  }

  // 1) حلّ task_ids أولًا (بترتيبها) ثم الروابط المباشرة
  const resolvedUrls: string[] = [];
  const failedIds: Array<{ id: string; reason: string }> = [];
  const taskIds = Array.isArray(args.task_ids) ? (args.task_ids as unknown[]).map(String) : [];
  for (const tid of taskIds) {
    const t = await getTask(tid);
    if (!t) {
      failedIds.push({ id: tid, reason: "لا توجد مهمة بهذا المعرّف" });
      continue;
    }
    if (t.type !== "video") {
      failedIds.push({ id: tid, reason: "ليست مهمة فيديو" });
      continue;
    }
    if (t.status !== "completed" || t.result_urls.length === 0) {
      failedIds.push({ id: tid, reason: `حالتها «${t.status === "processing" ? "قيد المعالجة" : t.status}» — يجب أن تكون مكتملة بروابط` });
      continue;
    }
    resolvedUrls.push(t.result_urls[0]);
  }
  if (failedIds.length > 0) {
    const details = failedIds.map((f) => `- ${f.id}: ${f.reason}`).join("\n");
    return failResult(`❌ تعذّر حلّ بعض المعرّفات:\n${details}\n\nالدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.`);
  }
  const directUrls = Array.isArray(args.urls) ? (args.urls as unknown[]).map(String) : [];
  const urls = [...resolvedUrls, ...directUrls];

  // 2) تحقق صارم
  if (urls.length < 2) {
    return failResult("❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.");
  }
  if (urls.length > 10) {
    return failResult("❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى).");
  }
  if (urls.some((u) => !/^https?:\/\//i.test(u))) {
    return failResult("❌ جميع الروابط يجب أن تكون http/https مباشرة وعامة.");
  }

  // 3) سجّل مهمة الدمج أولًا
  const taskId = crypto.randomUUID();
  const waitSeconds = effectiveWaitSeconds(args.wait_seconds, "merge");
  await insertTask({
    id: taskId,
    type: "merge",
    model: "video-merger",
    prompt: "",
    params_json: JSON.stringify({ urls, wait_seconds: args.wait_seconds ?? 60 }),
    provider: "merger",
    status: "processing",
  });

  // 4) أنشئ المهمة لدى الخدمة
  let jobId: string;
  try {
    const job = await mergerCreateJob(urls);
    jobId = job.jobId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("MERGER_NOT_CONFIGURED")) {
      await updateTask(taskId, { status: "failed", error_message: "خدمة الدمج غير مهيأة" });
      return failResult("❌ خدمة الدمج غير مهيأة على السيرفر — عيّن متغير البيئة MERGER_API_BASE ثم أعد المحاولة.");
    }
    // خطأ معلن من الخدمة (4xx/5xx بجسم error) = فشل نهائي فوري — لا إعادة محاولة
    const cls = classifyProviderError(err);
    const message = cls === "temporary" ? "تعذر الوصول لخدمة الدمج مؤقتًا" : msg;
    if (cls !== "temporary") {
      await updateTask(taskId, { status: "failed", error_message: message });
      return failResult(`❌ فشل الدمج: ${message}`);
    }
    await updateTask(taskId, { error_message: "بانتظار خدمة الدمج…" });
    return okResult(processingResultText(taskId));
  }
  await updateTask(taskId, { provider_task_id: jobId });

  // 5) أطلق process خلفيًا وبمرة واحدة فقط
  const t0 = await getTask(taskId);
  if (t0) await ensureProcessKicked(t0);

  // 6) نافذة انتظار 60 ثانية: استعلام كل 3 ثوانٍ مع كتابة الحالة في Turso فورًا
  const deadline = Date.now() + waitSeconds * 1_000;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const st = await mergerGetStatus(jobId);
      if (st.status === "done") {
        const url = st.videoUrl ?? st.downloadUrl ?? mergerFallbackVideoUrl(jobId);
        await updateTask(taskId, { status: "completed", progress: 100, result_urls: [url], error_message: null });
        return completedResult("merge", [url]);
      }
      if (st.status === "failed") {
        // قاعدة حتمية: أي خطأ معلن من الخدمة = فشل نهائي فوري — لا إعادة محاولة
        const message = st.error || "فشلت خدمة الدمج دون رسالة";
        await updateTask(taskId, { status: "failed", error_message: message });
        return failResult(`❌ فشل الدمج: ${message}`);
      }
      await updateTask(taskId, { progress: st.progress });
      if (opts.sendProgress) {
        try {
          await opts.sendProgress(st.progress, `جارٍ الدمج… ${st.progress}%`);
        } catch {
          // تجاهل
        }
      }
    } catch (err) {
      if (err instanceof ProviderError && err.status === 404) {
        const message = "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)";
        await updateTask(taskId, { status: "failed", error_message: message });
        return failResult(`❌ ${message}`);
      }
      // أخطاء شبكتنا نحن = مؤقتة → استمر بالاستعلام حتى انتهاء النافذة
    }
  }

  const t = await getTask(taskId);
  return okResult(processingResultText(taskId, t?.progress ?? 0));
}

/** get_task لمهمة دمج: حدّث من الخدمة، نفّذ process إن لم يُنفذ، و404 = فشل نهائي */
export async function refreshMergeTask(task: TaskRecord): Promise<ToolResult> {
  let jobId = task.provider_task_id;
  if (!jobId) {
    // فشل إنشاء المهمة لدى الخدمة سابقًا (خطأ مؤقت) — أعد المحاولة من الروابط المخزنة
    const params = (task.params ?? {}) as { urls?: unknown };
    const urls = Array.isArray(params.urls) ? (params.urls as unknown[]).map(String) : [];
    if (urls.length >= 2 && urls.every((u) => /^https?:\/\//i.test(u))) {
      try {
        const job = await mergerCreateJob(urls);
        jobId = job.jobId;
        await updateTask(task.id, { provider_task_id: jobId });
      } catch {
        return okResult(processingResultText(task.id, task.progress));
      }
    } else {
      return failResult("❌ مهمة الدمج بلا معرّف لدى الخدمة — أعد إنشاء الدمج من جديد.");
    }
  }
  await ensureProcessKicked(task);

  try {
    const st = await mergerGetStatus(jobId);
    if (st.status === "done") {
      const url = st.videoUrl ?? st.downloadUrl ?? mergerFallbackVideoUrl(jobId);
      await updateTask(task.id, { status: "completed", progress: 100, result_urls: [url], error_message: null });
      return completedResult("merge", [url]);
    }
    if (st.status === "failed") {
      const message = st.error || "فشلت خدمة الدمج دون رسالة";
      await updateTask(task.id, { status: "failed", error_message: message });
      return failResult(`❌ فشل الدمج: ${message}`);
    }
    await updateTask(task.id, { progress: st.progress });
    return okResult(processingResultText(task.id, st.progress));
  } catch (err) {
    if (err instanceof ProviderError && err.status === 404) {
      const message = "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)";
      await updateTask(task.id, { status: "failed", error_message: message });
      return failResult(`❌ ${message}`);
    }
    // مؤقت — المهمة تبقى جارية
    return okResult(processingResultText(task.id, task.progress));
  }
}

/* ————————— list_media ————————— */

export async function listMedia(opts: { type?: MediaType; status?: TaskRecord["status"]; limit?: number }): Promise<ToolResult> {
  const { listRecentTasks } = await import("./tasks");
  const tasks = await listRecentTasks(Math.min(50, Math.max(1, opts.limit ?? 10)), { type: opts.type, status: opts.status });
  if (tasks.length === 0) {
    const scope = opts.type ? ` من النوع «${opts.type}»` : "";
    return okResult(`📂 لا توجد وسائط مخزنة بعد${scope}.`);
  }
  const lines: string[] = [`📂 أحدث الوسائط المخزنة (${tasks.length}):`, ""];
  tasks.forEach((t, i) => {
    const typeLabel = t.type === "image" ? "صورة" : t.type === "video" ? "فيديو" : "دمج";
    const statusLabel = t.status === "completed" ? "✅ مكتملة" : t.status === "failed" ? "❌ فاشلة" : "⏳ قيد المعالجة";
    lines.push(`${i + 1}. [${typeLabel}] ${statusLabel} — ${t.created_at} — ${t.model}`);
    if (t.result_urls.length > 0) {
      for (const u of t.result_urls) lines.push(`   ${u}`);
    } else if (t.status === "processing") {
      lines.push(`   task_id: ${t.id}`);
    } else if (t.status === "failed" && t.error_message) {
      lines.push(`   السبب: ${t.error_message.slice(0, 200)}`);
    }
  });
  lines.push("", "استخدم get_task مع أي task_id جارٍ لمتابعته، أو افتح الروابط مباشرة.");
  return okResult(lines.join("\n"));
}
