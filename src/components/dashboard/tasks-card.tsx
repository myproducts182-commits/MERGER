"use client";

/**
 * لوحة المهام: شرائح إحصائيات + قائمة أحدث المهام تتحدث تلقائيًا كل ~5 ثوانٍ.
 * تعرض النوع والحالة وشريط التقدم والموديل ومقتطف الوصف ووقت الإنشاء وروابط النتائج وعدد المحاولات.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, RefreshCw } from "lucide-react";
import { timeAgo, type TaskInfo } from "./types";

const TYPE_LABEL: Record<TaskInfo["type"], string> = { image: "صورة", video: "فيديو", merge: "دمج" };
const STATUS_LABEL: Record<TaskInfo["status"], string> = {
  pending: "بانتظار",
  processing: "قيد المعالجة",
  completed: "مكتملة",
  failed: "فاشلة",
};

function typeBadge(t: TaskInfo["type"]) {
  const cls =
    t === "image"
      ? "bg-violet-100 text-violet-800 border-violet-200"
      : t === "video"
        ? "bg-teal-100 text-teal-800 border-teal-200"
        : "bg-orange-100 text-orange-800 border-orange-200";
  return <Badge variant="outline" className={cls}>{TYPE_LABEL[t]}</Badge>;
}

function statusBadge(t: TaskInfo) {
  if (t.status === "completed") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">✅ {STATUS_LABEL[t.status]}</Badge>;
  if (t.status === "failed") return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">❌ {STATUS_LABEL[t.status]}</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 animate-pulse">⏳ {STATUS_LABEL[t.status]}</Badge>;
}

function StatChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${cls}`}>
      <div className="text-xl font-bold leading-none">{value}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}

export default function TasksCard() {
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0, processing: 0 });
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?limit=20", { cache: "no-store" });
      const data = await res.json();
      if (data.stats) setStats(data.stats);
      if (data.tasks) setTasks(data.tasks);
    } catch {
      // تجاهل أخطاء التحديث الدوري
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card className="border shadow-sm" dir="rtl">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">📋 لوحة المهام</CardTitle>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> تحديث تلقائي كل 5 ثوانٍ
            </span>
            <button onClick={load} className="inline-flex items-center gap-1 hover:text-gray-600" aria-label="تحديث الآن">
              <RefreshCw className="h-3.5 w-3.5" /> تحديث
            </button>
          </div>
        </div>
        <CardDescription>أحدث المهام حية — التوليد غير متزامن: task_id فورًا ثم متابعة تلقائية بـ get_task.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* شرائح الإحصائيات */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatChip label="الإجمالي" value={stats.total} cls="bg-white border-gray-200 text-gray-800" />
          <StatChip label="مكتملة" value={stats.completed} cls="bg-emerald-50 border-emerald-200 text-emerald-800" />
          <StatChip label="فاشلة" value={stats.failed} cls="bg-red-50 border-red-200 text-red-700" />
          <StatChip label="جارية" value={stats.processing} cls="bg-amber-50 border-amber-200 text-amber-800" />
        </div>

        {/* القائمة */}
        <div className="max-h-[26rem] overflow-y-auto space-y-2 pe-1">
          {loading ? (
            <p className="text-sm text-gray-500 py-6 text-center">جارٍ التحميل…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">لا توجد مهام بعد — استدعِ generate_image أو generate_video من أي عميل MCP.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="rounded-lg border bg-white p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {typeBadge(t.type)}
                  {statusBadge(t)}
                  <span className="text-xs font-mono text-gray-500 truncate max-w-[16rem]" dir="ltr">{t.model}</span>
                  {t.attempts_count > 0 && (
                    <Badge variant="outline" className="text-xs text-gray-500">محاولات: {t.attempts_count}</Badge>
                  )}
                  <span className="text-xs text-gray-400 ms-auto">{timeAgo(t.created_at)}</span>
                </div>

                {(t.status === "processing" || (t.status === "completed" && t.progress < 100)) && (
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${t.status === "completed" ? "bg-emerald-500" : "bg-amber-500"}`}
                      style={{ width: `${Math.max(4, Math.min(100, t.progress))}%` }}
                    />
                  </div>
                )}

                {t.prompt && (
                  <p className="text-sm text-gray-700 line-clamp-2" dir="auto">{t.prompt}</p>
                )}

                {t.status === "failed" && t.error_message && (
                  <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 break-words" dir="auto">{t.error_message}</p>
                )}
                {t.status === "processing" && t.error_message === "بانتظار توفر مفتاح صالح…" && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">بانتظار توفر مفتاح صالح — ستُستأنف تلقائيًا مع استعلام get_task التالي.</p>
                )}

                {t.result_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t.result_urls.slice(0, 3).map((u) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 hover:bg-emerald-100"
                        dir="ltr"
                      >
                        <ExternalLink className="h-3 w-3" /> فتح الرابط
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
