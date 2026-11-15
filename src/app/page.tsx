"use client";

/** لوحة الإدارة الرئيسية — هيدر بحالة الجهوزية + ثلاث بطاقات: المفاتيح / المهام / الربط (ثيم «أورورا» داكن) */
import { useEffect, useState } from "react";
import KeysCard from "@/components/dashboard/keys-card";
import TasksCard from "@/components/dashboard/tasks-card";
import ConnectCard from "@/components/dashboard/connect-card";
import { Badge } from "@/components/ui/badge";
import type { HealthInfo } from "@/components/dashboard/types";

export default function Dashboard() {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        setHealth(data);
      } catch {
        setHealth(null);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const dbConnected = health?.database === "turso-connected";
  const models = health?.models ?? [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* توهجات الخلفية «أورورا» */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -start-24 h-96 w-96 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="absolute top-1/4 -end-28 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-0 start-1/3 h-80 w-80 rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
        {/* الهيدر */}
        <header className="mb-7 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-wrap">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              🎬 <span className="text-gradient">MCP Media Generator</span>
            </h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              توليد الصور والفيديو بأي موديل ومن أي مزود خدمة — تبديل تسلسلي تلقائي للمفاتيح ودمج المقاطع في خادم MCP واحد
            </p>
          </div>
          <div className="flex items-center gap-2 sm:ms-auto flex-wrap">
            <Badge
              className={`px-3 py-1.5 border backdrop-blur ${dbConnected ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/20" : "bg-red-500/15 text-red-300 border-red-400/30 hover:bg-red-500/20"}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full me-1.5 ${dbConnected ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-red-400"}`} />
              {dbConnected ? "Turso متصل" : "غير متصل"}
            </Badge>
            {health && (
              <Badge
                className={`px-3 py-1.5 border backdrop-blur ${health.merger.healthy ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/20" : "bg-amber-500/15 text-amber-300 border-amber-400/30 hover:bg-amber-500/20"}`}
              >
                الدمج: {health.merger.healthy ? "جاهزة" : "غير مضبوطة"}
              </Badge>
            )}
          </div>
        </header>

        {/* لافتة إعداد قاعدة البيانات — تظهر فقط عند انقطاع الاتصال */}
        {health && !dbConnected && (
          <div className="mb-7 rounded-xl border border-red-400/30 bg-red-500/10 p-4 space-y-2">
            <p className="font-semibold text-red-200">⚠️ قاعدة البيانات غير مربوطة — لهذا يفشل حفظ المفاتيح والمهام</p>
            <p className="text-sm text-red-100/85 leading-relaxed">
              السيرفر لا يجد متغيرَي البيئة <span dir="ltr" className="font-mono">TURSO_DATABASE_URL</span> و
              <span dir="ltr" className="font-mono">TURSO_AUTH_TOKEN</span> — الإصلاح يستغرق دقيقة:
            </p>
            <ol className="text-sm text-red-100/85 list-decimal ps-5 space-y-1 leading-relaxed">
              <li>أنشئ قاعدة مجانية على <span dir="ltr">turso.tech</span> (أو افتح قاعدتك السابقة) وانسخ «Database URL» و«Auth Token».</li>
              <li>في Vercel: مشروعك → Settings → Environment Variables → أضف المتغيرين بالاسم والقيمة نفسها لبيئة Production.</li>
              <li>ثم Settings → Deployments → Redeploy، وحدّث هذه الصفحة — ستختفي هذه اللافتة وتعود مفاتيحك ومهامك المحفوظة.</li>
            </ol>
          </div>
        )}

        {/* الموديلات المدمجة */}
        {models.length > 0 && (
          <div className="mb-7 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">الموديلات الافتراضية:</span>
            {models.map((m) => (
              <Badge key={m.canonical} variant="outline" className="font-mono bg-white/5 border-white/15 text-slate-300" dir="ltr">
                {m.canonical}
              </Badge>
            ))}
            <span className="text-slate-500">— ويُقبل أي اسم موديل آخر يدعمه مزودك</span>
          </div>
        )}

        {/* البطاقات الثلاث */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <KeysCard />
          </div>
          <div className="lg:col-span-2">
            <TasksCard />
          </div>
        </div>
        <div className="mt-6">
          <ConnectCard health={health} />
        </div>

        <footer className="mt-10 pb-6 text-center text-xs text-slate-500">
          MCP Media Generator · روابط فقط بلا تنزيل وسائط · مفاتيح مقنعة دائمًا · تبديل تسلسلي صامت
          <span className="mt-1 block" dir="ltr">build v2026.11.15-c</span>
        </footer>
      </div>
    </main>
  );
}
