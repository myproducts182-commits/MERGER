/**
 * الوصول الموحد لمتغيرات البيئة مع قيم افتراضية آمنة.
 * ملاحظة أمنية: لا تُطبع المفاتيح الكاملة في السجلات أبدًا — نستخدم maskKey في كل مكان.
 */

/** نافذة الانتظار القصوى الفعلية لاستدعاء أداة واحدة (لحماية حدود دوال Vercel) */
export function maxEffectiveWaitSeconds(): number {
  const raw = parseInt(process.env.MCP_MAX_WAIT_SECONDS || "50", 10);
  if (Number.isNaN(raw)) return 50;
  return Math.min(Math.max(raw, 10), 240);
}

/** عنوان خدمة الدمج — فارغ أو حامل قيمة العرض المؤقت يعني "غير مهيأة" */
export function mergerBase(): string {
  const raw = (process.env.MERGER_API_BASE || "").trim();
  if (!raw || raw.includes("xxxx")) return "";
  return raw.replace(/\/+$/, "");
}

export function mcpAccessToken(): string {
  return (process.env.MCP_ACCESS_TOKEN || "").trim();
}

export function isMcpAuthRequired(): boolean {
  return mcpAccessToken().length > 0;
}
