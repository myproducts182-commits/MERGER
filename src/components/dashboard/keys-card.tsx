"use client";

/**
 * مدير المفاتيح: إضافة (مزود + تسمية + مفتاح) وقائمة مقنعة دائمًا مع حالة وعدّادات وأزرار تعطيل/تنشيط/حذف.
 * قاعدة ثابتة: التجربة تسلسلية حسب ترتيب الإضافة مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, RefreshCw, Trash2, Power, Loader2 } from "lucide-react";
import { timeAgo, type KeyInfo } from "./types";

const PROVIDER_LABEL: Record<string, string> = { kie: "kie.ai", cometapi: "CometAPI" };

function statusBadge(status: KeyInfo["status"]) {
  if (status === "active") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">نشط</Badge>;
  if (status === "exhausted") return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">مستنزف</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">معطّل</Badge>;
}

export default function KeysCard() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [provider, setProvider] = useState("kie");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      const data = await res.json();
      if (data.keys) setKeys(data.keys);
    } catch {
      // تجاهل أخطاء التحديث الدوري
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  async function addKey() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey, label }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error || "فشلت الإضافة" });
      } else {
        setMessage({ kind: "ok", text: `تمت إضافة المفتاح ${data.masked ?? ""} بنجاح — سيُجرَّب أولًا حسب ترتيب الإضافة.` });
        setApiKey("");
        setLabel("");
        await load();
      }
    } catch {
      setMessage({ kind: "error", text: "تعذر الاتصال بالسيرفر" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(k: KeyInfo) {
    setRowBusy(k.id);
    try {
      const next = k.status === "disabled" ? "active" : "disabled";
      await fetch(`/api/keys/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      await load();
    } finally {
      setRowBusy(null);
    }
  }

  async function removeKey(k: KeyInfo) {
    setRowBusy(k.id);
    try {
      await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
      await load();
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <Card className="border shadow-sm" dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          🔑 مدير المفاتيح
        </CardTitle>
        <CardDescription>
          أضف عدة مفاتيح لكل مزود — التجربة تسلسلية (أول مفتاح ثم التالي ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد دون توقف.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* نموذج الإضافة */}
        <div className="grid gap-3 sm:grid-cols-[150px_1fr_1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="provider">المزود</Label>
            <Select value={provider} onValueChange={setProvider} dir="rtl">
              <SelectTrigger id="provider" className="w-full">
                <SelectValue placeholder="اختر المزود" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie">kie.ai</SelectItem>
                <SelectItem value="cometapi">CometAPI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="keylabel">تسمية (اختياري)</Label>
            <Input id="keylabel" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: الحساب الرئيسي" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apikey">المفتاح</Label>
            <Input
              id="apikey"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="الصق مفتاح API هنا"
              dir="ltr"
            />
          </div>
          <Button onClick={addKey} disabled={busy || !apiKey.trim()} className="min-h-11">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة
          </Button>
        </div>

        {message && (
          <p className={`text-sm rounded-md px-3 py-2 ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`} dir="auto">
            {message.text}
          </p>
        )}

        {/* القائمة */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">المفاتيح ({keys.length})</h3>
          <Button variant="ghost" size="sm" onClick={load} className="text-gray-500">
            <RefreshCw className="h-4 w-4" /> تحديث
          </Button>
        </div>

        <ScrollArea className="max-h-96">
          <div className="space-y-2 pe-2">
            {loading ? (
              <p className="text-sm text-gray-500 py-6 text-center">جارٍ التحميل…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لبدء التوليد.</p>
            ) : (
              keys.map((k) => (
                <div key={k.id} className="rounded-lg border bg-white p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs" dir="ltr">{PROVIDER_LABEL[k.provider] ?? k.provider}</Badge>
                    {statusBadge(k.status)}
                    {k.label ? <span className="text-sm font-medium">{k.label}</span> : null}
                    <span className="text-xs text-gray-400 ms-auto">{timeAgo(k.created_at)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                    <span>الاستخدام: <b>{k.usage_count}</b></span>
                    <span>نجاح: <b className="text-emerald-700">{k.success_count}</b></span>
                    <span>فشل: <b className="text-red-700">{k.fail_count}</b></span>
                    <span>آخر استخدام: {timeAgo(k.last_used_at)}</span>
                  </div>
                  {k.last_error && (
                    <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 break-words" dir="auto">آخر خطأ: {k.last_error}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleStatus(k)}
                      disabled={rowBusy === k.id}
                      className="min-h-9"
                    >
                      {rowBusy === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                      {k.status === "disabled" ? "تنشيط" : "تعطيل"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeKey(k)}
                      disabled={rowBusy === k.id}
                      className="min-h-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" /> حذف
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
