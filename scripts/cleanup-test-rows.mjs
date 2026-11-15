/**
 * تنظيف آثار الاختبار: فحص محاولات المهمة التجريبية (إثبات توجيه المزود المخصص) ثم حذفها.
 * تشغيل: node --env-file=.env.local scripts/cleanup-test-rows.mjs
 */
import { createClient } from "@libsql/client";

const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 1) أظهر المهام التجريبية ومحاولاتها (للتوثيق فقط)
const rows = await c.execute("SELECT id, model, provider, status, attempts_json FROM tasks WHERE model = 'test-custom-model-xyz' ORDER BY created_at DESC LIMIT 5");
for (const r of rows.rows) {
  console.log("task:", r.id, "| status:", r.status, "| provider:", r.provider);
  let attempts = [];
  try { attempts = JSON.parse(String(r.attempts_json ?? "[]")); } catch {}
  for (const a of attempts) console.log("  attempt →", a.provider, "| ok:", a.ok, "| class:", a.errorClass, "| error:", (a.error || "").slice(0, 120));
}

// 2) احذفها
const del = await c.execute("DELETE FROM tasks WHERE model = 'test-custom-model-xyz'");
console.log("deleted test tasks:", del.rowsAffected);

// 3) تأكد أن قاعدة البيانات لم تعد تحوي أي مهام تجريبية
const left = await c.execute("SELECT COUNT(*) AS n FROM tasks");
console.log("remaining tasks total:", left.rows[0].n);
