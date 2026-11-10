/**
 * طبقة قاعدة البيانات — Turso عبر @libsql/client (HTTP) للتوافق مع Vercel serverless.
 * لا ملفات SQLite محلية إطلاقًا؛ ensureSchema ينشئ الجداول عند أول وصول دون أداة migrations.
 */
import { createClient, type Client, type InValue } from "@libsql/client";

let _client: Client | null = null;
let schemaPromise: Promise<void> | null = null;

export function getTurso(): Client {
  // تنظيف إلزامي من مسافات/أسطر لاصقة — خطأ شائع عند اللصق في Vercel (يظهر كـ URL_INVALID من libsql)
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  const token = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN غير مضبوطة في متغيرات البيئة");
  }
  if (!_client) {
    // عميل واحد لكل العملية — libsql يتصل عبر HTTP ومناسب للـ serverless
    _client = createClient({ url, authToken: token });
  }
  return _client;
}

/** مخطط الجداول — مطابق للمواصفة حرفيًا */
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    provider TEXT,
    provider_task_id TEXT,
    key_id TEXT,
    model TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT DEFAULT '',
    params_json TEXT DEFAULT '{}',
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    result_urls_json TEXT,
    error_message TEXT,
    attempts_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT DEFAULT '',
    api_key TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    usage_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    last_checked_at TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

/** تنشئ الجداول مرة واحدة لكل عملية (فشل مؤقت يعيد المحاولة لاحقًا) */
export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const c = getTurso();
      for (const sql of SCHEMA_SQL) {
        await c.execute(sql);
      }
    })().catch((err) => {
      schemaPromise = null; // اسمح بإعادة المحاولة في الطلب القادم
      throw err;
    });
  }
  return schemaPromise;
}

/** فحص صحة قاعدة البيانات: SELECT 1 بعد ضمان المخطط */
export async function dbHealthy(): Promise<boolean> {
  try {
    await ensureSchema();
    const rs = await getTurso().execute("SELECT 1");
    return rs.rows.length > 0;
  } catch {
    return false;
  }
}

/** تنفيذ استعلام مع وسائط آمنة */
export async function query(sql: string, args: InValue[] = []) {
  await ensureSchema();
  return getTurso().execute({ sql, args });
}
