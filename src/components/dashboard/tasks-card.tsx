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
      ? "bg-violet-500/15 text-violet-300 border-violet-400/30"
      : t === "video"
        ? "bg-cyan-500/15 text-cyan-300 border-cyan-400/30"
        : "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-400/30";
  return <Badge variant="outline" className={cls}>{TYPE_LABEL[t]}</Badge>;
}

function statusBadge(t: TaskInfo) {
  if (t.status === "completed") return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/25">✅ {STATUS_LABEL[t.status]}</Badge>;
  if (t.status === "failed") return <Badge className="bg-red-500/15 text-red-300 border-red-400/30 hover:bg-red-500/25">❌ {STATUS_LABEL[t.status]}</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-300 border-amber-400/30 hover:bg-amber-500/25 animate-pulse">⏳ {STATUS_LABEL[t.status]}</Badge>;
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
    <Card className="border-white/10 shadow-xl shadow-black/25 backdrop-blur" dir="rtl">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">📋 لوحة المهام</CardTitle>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px] shadow-emerald-400" /> تحديث تلقائي كل 5 ثوانٍ
            </span>
            <button onClick={load} className="inline-flex items-center gap-1 hover:text-slate-300" aria-label="تحديث الآن">
              <RefreshCw className="h-3.5 w-3.5" /> تحديث
            </button>
          </div>
        </div>
        <CardDescription>أحدث المهام حية — التوليد غير متزامن: task_id فورًا ثم متابعة تلقائية بـ get_task.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* شرائح الإحصائيات */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatChip label="الإجمالي" value={stats.total} cls="bg-white/5 border-white/10 text-slate-200" />
          <StatChip label="مكتملة" value={stats.completed} cls="bg-emerald-500/10 border-emerald-400/25 text-emerald-300" />
          <StatChip label="فاشلة" value={stats.failed} cls="bg-red-500/10 border-red-400/25 text-red-300" />
          <StatChip label="جارية" value={stats.processing} cls="bg-amber-500/10 border-amber-400/25 text-amber-300" />
        </div>

        {/* القائمة */}
        <div className="max-h-[26rem] overflow-y-auto space-y-2 pe-1">
          {loading ? (
            <p className="text-sm text-slate-400 py-6 text-center">جارٍ التحميل…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">لا توجد مهام بعد — استدعِ generate_image أو generate_video من أي عميل MCP.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {typeBadge(t.type)}
                  {statusBadge(t)}
                  <span className="text-xs font-mono text-slate-400 truncate max-w-[16rem]" dir="ltr">{t.model}</span>
                  {t.attempts_count > 0 && (
                    <Badge variant="outline" className="text-xs text-slate-400 border-white/15">محاولات: {t.attempts_count}</Badge>
                  )}
                  <span className="text-xs text-slate-500 ms-auto">{timeAgo(t.created_at)}</span>
                </div>

                {(t.status === "processing" || (t.status === "completed" && t.progress < 100)) && (
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${t.status === "completed" ? "bg-emerald-400" : "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400"}`}
                      style={{ width: `${Math.max(4, Math.min(100, t.progress))}%` }}
                    />
                  </div>
                )}

                {t.prompt && (
                  <p className="text-sm text-slate-300 line-clamp-2" dir="auto">{t.prompt}</p>
                )}

                {t.status === "failed" && t.error_message && (
                  <p className="text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1 break-words" dir="auto">{t.error_message}</p>
                )}
                {t.status === "processing" && t.error_message === "بانتظار توفر مفتاح صالح…" && (
                  <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-1">بانتظار توفر مفتاح صالح — ستُستأنف تلقائيًا مع استعلام get_task التالي.</p>
                )}

                {t.result_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t.result_urls.slice(0, 3).map((u) => (
                      <a
                        key={u}
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-400/30 rounded px-2 py-1 hover:bg-cyan-500/20"
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
