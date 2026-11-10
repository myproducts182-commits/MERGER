/**
 * تنظيف آثار الاختبار: حذف المهام المخزنة + المفاتيح الوهمية، وإعادة المفتاح الحقيقي نظيفًا.
 * يتطلب متغيرات البيئة TURSO_DATABASE_URL و TURSO_AUTH_TOKEN (لا تُخزَّن الأسرار في الكود أبدًا).
 * الاستخدام: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/cleanup-test-data.mjs [realKey]
 */
import { createClient } from "@libsql/client";

const REAL_KEY = process.argv[2] || "";
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("يجب ضبط TURSO_DATABASE_URL و TURSO_AUTH_TOKEN في البيئة أولًا");
  process.exit(1);
}
if (!REAL_KEY) {
  console.error("مرر المفتاح الحقيقي الذي تريد إبقائه: node scripts/cleanup-test-data.mjs <realKey>");
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await client.execute("DELETE FROM tasks");
console.log("tasks: deleted all test tasks");

await client.execute("DELETE FROM api_keys WHERE api_key != ?", [REAL_KEY]);
await client.execute(
  "UPDATE api_keys SET status = 'active', usage_count = 0, success_count = 0, fail_count = 0, last_used_at = NULL, last_checked_at = NULL, last_error = NULL WHERE api_key = ?",
  [REAL_KEY],
);
const rs = await client.execute("SELECT provider, label, status FROM api_keys");
console.log("api_keys:", rs.rows.map((r) => `${r.provider}/${r.label}=${r.status}`).join(" | "));
console.log("cleanup done");
