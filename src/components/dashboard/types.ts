/** أنواع مشتركة لواجهة لوحة الإدارة */
export interface HealthInfo {
  ok: boolean;
  database: string;
  mcpEndpoint: string;
  models: Array<{ canonical: string; type: string; providers: string[] }>;
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
}

export interface KeyInfo {
  id: string;
  provider: string;
  label: string;
  status: "active" | "exhausted" | "disabled";
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface TaskInfo {
  id: string;
  type: "image" | "video" | "merge";
  model: string;
  provider: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  prompt: string;
  result_urls: string[];
  error_message: string | null;
  attempts_count: number;
  created_at: string;
  completed_at: string | null;
}

/** يحلل وقت SQLite (UTC بدون منطقة زمنية) ويعيد Date صحيحة */
export function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** وقت نسبي عربي مختصر */
export function timeAgo(s: string | null | undefined): string {
  const d = parseUtc(s);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "قبل لحظات";
  const min = Math.round(sec / 60);
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const day = Math.round(hr / 24);
  if (day < 30) return `قبل ${day} يوم`;
  return d.toLocaleDateString("ar");
}
