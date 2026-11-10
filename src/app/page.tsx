"use client";

/** لوحة الإدارة الرئيسية — هيدر بحالة الجهوزية + ثلاث بطاقات: المفاتيح / المهام / الربط */
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
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* الهيدر */}
        <header className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              🎬 MCP Media Generator
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              خادم MCP لتوليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع — مع تبديل تسلسلي تلقائي للمفاتيح
            </p>
          </div>
          <div className="flex items-center gap-2 sm:ms-auto flex-wrap">
            <Badge
              className={`px-3 py-1.5 ${dbConnected ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100" : "bg-red-100 text-red-700 border border-red-200 hover:bg-red-100"}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full me-1.5 ${dbConnected ? "bg-emerald-500" : "bg-red-500"}`} />
              {dbConnected ? "Turso متصل" : "غير متصل"}
            </Badge>
            {health && (
              <Badge
                className={`px-3 py-1.5 border ${health.merger.healthy ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50" : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-50"}`}
              >
                الدمج: {health.merger.healthy ? "جاهزة" : "غير مضبوطة"}
              </Badge>
            )}
          </div>
        </header>

        {/* الموديلات المدمجة */}
        {models.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-400">الموديلات المدمجة:</span>
            {models.map((m) => (
              <Badge key={m.canonical} variant="outline" className="font-mono bg-white" dir="ltr">
                {m.canonical}
              </Badge>
            ))}
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

        <footer className="mt-10 pb-6 text-center text-xs text-gray-400">
          MCP Media Generator · روابط فقط بلا تنزيل وسائط · مفاتيح مقنعة دائمًا · تبديل تسلسلي صامت
        </footer>
      </div>
    </main>
  );
}
