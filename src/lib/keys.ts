/**
 * نظام المفاتيح المتسلسلة — قلب المشروع.
 *
 * قواعد جوهرية:
 * - الترتيب تسلسلي صارم حسب ترتيب الإضافة (created_at ASC, id ASC) — ليس round-robin.
 * - المفتاح المستنزف (exhausted) يبقى في القائمة والقاعدة؛ الاستثناء الوحيد التعطيل اليدوي (disabled).
 * - maskKey إلزامي: لا يُعاد المفتاح الكامل في أي استجابة أو سجل.
 */
import { randomUUID } from "node:crypto";
import { query } from "./turso";
import { ProviderError, type ErrorClass, type KeyRecord, type ProviderId } from "./types";

/** إخفاء المفتاح: أول 7 أحرف + •••••••• + آخر 4 (أو أول 3 + •••• للقصير) */
export function maskKey(key: string): string {
  if (key.length <= 8) {
    return key.slice(0, Math.min(3, key.length)) + "••••";
  }
  return `${key.slice(0, 7)}••••••••${key.slice(-4)}`;
}

function rowToKey(r: Record<string, unknown>): KeyRecord {
  return {
    id: String(r.id),
    provider: r.provider as ProviderId,
    label: String(r.label ?? ""),
    api_key: String(r.api_key),
    status: (r.status as KeyRecord["status"]) ?? "active",
    usage_count: Number(r.usage_count ?? 0),
    success_count: Number(r.success_count ?? 0),
    fail_count: Number(r.fail_count ?? 0),
    last_used_at: (r.last_used_at as string) ?? null,
    last_checked_at: (r.last_checked_at as string) ?? null,
    last_error: (r.last_error as string) ?? null,
    created_at: String(r.created_at ?? ""),
  };
}

/**
 * تجلب كل المفاتيح غير المعطّلة لهذه المزودات بالترتيب التسلسلي الصارم.
 * المفتاح المستنزف يبقى مرشحًا (تجربة المفتاح المستنزف رخيصة: 402 فورية) — فقط disabled يُستبعد.
 */
export async function getKeyPool(providers: ProviderId[]): Promise<KeyRecord[]> {
  if (providers.length === 0) return [];
  const placeholders = providers.map(() => "?").join(",");
  const rs = await query(
    `SELECT * FROM api_keys
     WHERE status != 'disabled' AND provider IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    providers as never[],
  );
  return rs.rows.map((r) => rowToKey(r as unknown as Record<string, unknown>));
}

export async function getKeyById(id: string): Promise<KeyRecord | null> {
  const rs = await query("SELECT * FROM api_keys WHERE id = ? LIMIT 1", [id]);
  if (rs.rows.length === 0) return null;
  return rowToKey(rs.rows[0] as unknown as Record<string, unknown>);
}

export async function listKeys(): Promise<Omit<KeyRecord, "api_key">[]> {
  const rs = await query("SELECT * FROM api_keys ORDER BY created_at ASC, id ASC");
  return rs.rows.map((r) => {
    const k = rowToKey(r as unknown as Record<string, unknown>);
    const { api_key: _hidden, ...rest } = k; // إخفاء المفتاح الكامل دائمًا
    return rest;
  });
}

export async function addKey(provider: ProviderId, apiKey: string, label: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // رفض التكرار لنفس المزود
  const dup = await query("SELECT id FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1", [provider, apiKey]);
  if (dup.rows.length > 0) {
    return { ok: false, error: "هذا المفتاح مضاف مسبقًا لنفس المزود" };
  }
  const id = randomUUID();
  await query(
    `INSERT INTO api_keys (id, provider, label, api_key) VALUES (?, ?, ?, ?)`,
    [id, provider, label, apiKey],
  );
  return { ok: true, id };
}

export async function setKeyStatus(id: string, status: "active" | "disabled"): Promise<boolean> {
  const rs = await query("UPDATE api_keys SET status = ? WHERE id = ?", [status, id]);
  return rs.rowsAffected > 0;
}

export async function deleteKey(id: string): Promise<boolean> {
  const rs = await query("DELETE FROM api_keys WHERE id = ?", [id]);
  return rs.rowsAffected > 0;
}

/**
 * تصنيف خطأ المزود — يحدد سلوك التبديل:
 * disabled  → مفتاح مرفوض (401/403 أو رسالة توثيق) → علّمه disabled → التالي
 * exhausted → نفاد رصيد (402 أو رسالة رصيد، تُفحص قبل 400 لأن بعض المزودين يرسلونها بحالة 400)
 * provider  → الموديل غير مدعوم لدى المزود → التالي
 * params    → خطأ معطيات الطلب → توقف فورًا (تبديل المفاتيح لن يحل شيئًا)
 * temporary → 429/5xx/شبكة/timeout → التالي الآن والمفتاح يبقى سليمًا
 */
export function classifyProviderError(err: unknown): ErrorClass {
  const status = err instanceof ProviderError ? err.status : undefined;
  const message = err instanceof Error ? err.message : String(err ?? "");
  const msg = message.toLowerCase();
  const has = (re: RegExp) => re.test(msg);

  // 1) نفاد الرصيد أولًا — قد يصل بحالة 400/200 لدى بعض المزودين
  if (status === 402 || has(/insufficient|quota|balance|credit|out of credits|exhausted|充值/)) {
    return "exhausted";
  }
  // 2) مفتاح مرفوض
  if (status === 401 || status === 403 || has(/invalid api key|invalid_api_key|unauthorized|forbidden|authentication failed|authentication/)) {
    return "disabled";
  }
  // 3) موديل غير مدعوم
  if (has(/model not found|unsupported model|no such model|unknown model/) && (status === 400 || status === 404 || status === 422)) {
    return "provider";
  }
  // 4) معطيات خاطئة — لا فائدة من تبديل المفاتيح
  if (status === 400 || status === 422) {
    return "params";
  }
  // 5) كل ما عدا ذلك مؤقت (429، 5xx، شبكة، timeout)
  return "temporary";
}

/** هل رسالة الفشل تطابق نمط مشكلات مفتاح/رصيد (تُستخدم لقرار التبديل في منتصف المهمة) */
export function isKeyOrBalancePattern(message: string): boolean {
  const msg = (message || "").toLowerCase();
  return /insufficient|balance|credit|quota|402|401|unauthorized|invalid api key|authentication|充值/.test(msg);
}

export interface KeyCounterUpdate {
  ok: boolean;
  errorClass?: ErrorClass;
  error?: string;
  /** تحديث آخر وقت فحص (عند استعلام حالة مهمة جارية) */
  touchOnly?: boolean;
}

/** تحديث عدادات المفتاح + الحالة حسب الفئة — يُستدعى دائمًا بعد كل محاولة أو فحص */
export async function updateKeyCounters(key: KeyRecord, upd: KeyCounterUpdate): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];

  if (upd.touchOnly) {
    sets.push("last_checked_at = datetime('now')");
  } else {
    sets.push("usage_count = usage_count + 1", "last_used_at = datetime('now')", "last_checked_at = datetime('now')");
    if (upd.ok) {
      sets.push("success_count = success_count + 1", "last_error = NULL");
    } else {
      sets.push("fail_count = fail_count + 1");
      args.push((upd.error || "خطأ غير معروف").slice(0, 500));
      sets.push("last_error = ?");
      // التعليم الآلي للحالة حسب الفئة: disabled يُعطّل، exhausted يُعلَّم ويبقى في القاعدة
      if (upd.errorClass === "disabled") sets.push("status = 'disabled'");
      else if (upd.errorClass === "exhausted") sets.push("status = 'exhausted'");
    }
  }
  args.push(key.id);
  await query(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`, args as never[]);
}
