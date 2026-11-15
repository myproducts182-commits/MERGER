"use client";

/**
 * مدير المفاتيح: إضافة (أي مزود + تسمية + مفتاح + رابط API مخصص للمزودات الخارجية)
 * وقائمة مقنعة دائمًا مع حالة وعدّادات وأزرار تعطيل/تنشيط/حذف.
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
import { Plus, RefreshCw, Trash2, Power, Loader2, Globe } from "lucide-react";
import { timeAgo, type KeyInfo } from "./types";

const PROVIDER_LABEL: Record<string, string> = { kie: "kie.ai", cometapi: "CometAPI" };
/** المزودات المعروفة — ما عداها «مخصص» ويلزمه رابط API */
const KNOWN_PROVIDERS = ["kie", "cometapi"];

const STATUS_BADGE: Record<KeyInfo["status"], { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30 hover:bg-emerald-500/25" },
  exhausted: { label: "مستنزف", cls: "bg-amber-500/15 text-amber-300 border-amber-400/30 hover:bg-amber-500/25" },
  disabled: { label: "معطّل", cls: "bg-slate-500/20 text-slate-400 border-slate-400/30 hover:bg-slate-500/30" },
};

function statusBadge(status: KeyInfo["status"]) {
  const s = STATUS_BADGE[status];
  return <Badge className={s.cls}>{s.label}</Badge>;
}

export default function KeysCard() {
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [provider, setProvider] = useState("kie");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiStyle, setApiStyle] = useState("kie");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isCustom = !KNOWN_PROVIDERS.includes(provider.trim().toLowerCase());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      const data = await res.json();
      if (data.keys) setKeys(data.keys);
      setLoadError(data.keys ? null : data.error || `خطأ ${res.status} عند تحميل المفاتيح`);
    } catch {
      setLoadError("تعذر الاتصال بالسيرفر");
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
    setMessage(null);
    // الزر لا يُعطَّل أبدًا — نتحقق عند النقر ونعرض سبب الرفض بوضوح حتى لا يبدو الزر «ميتًا»
    if (!apiKey.trim()) {
      setMessage({ kind: "error", text: "ألصق مفتاح API في حقل «المفتاح» أولًا، ثم اضغط إضافة." });
      return;
    }
    if (!provider.trim()) {
      setMessage({ kind: "error", text: "أدخل اسم المزود (مثال: kie أو cometapi أو أي اسم مخصص)." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.trim().toLowerCase(),
          api_key: apiKey,
          label,
          base_url: baseUrl.trim() || undefined,
          api_style: isCustom ? apiStyle : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error || `فشلت الإضافة (رمز ${res.status})` });
      } else {
        setMessage({ kind: "ok", text: `تمت إضافة المفتاح ${data.masked ?? ""} بنجاح — سيُجرَّب أولًا حسب ترتيب الإضافة.` });
        setApiKey("");
        setLabel("");
        setBaseUrl("");
        await load();
      }
    } catch {
      setMessage({ kind: "error", text: "تعذر الاتصال بالسيرفر — تحقق من حالة النشر في Vercel ثم حدّث الصفحة." });
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
    <Card className="border-white/10 shadow-xl shadow-black/25 backdrop-blur" dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          🔑 مدير المفاتيح
        </CardTitle>
        <CardDescription>
          أي مزود خدمة يقبل المفاتيح: اختر مزودًا معروفًا أو أدخل اسم مزود مخصص مع رابط API — والتجربة تسلسلية (أول مفتاح ثم التالي) مع تبديل فوري تلقائي عند أي خطأ أو نفاد رصيد.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* نموذج الإضافة — الصف الأول */}
        <div className="grid gap-3 sm:grid-cols-[150px_1fr_1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="provider">المزود</Label>
            <Input
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              list="provider-suggestions"
              placeholder="kie / cometapi / مخصص"
              dir="ltr"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <datalist id="provider-suggestions">
              <option value="kie" />
              <option value="cometapi" />
            </datalist>
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
          <Button onClick={addKey} disabled={busy} className="min-h-11 bg-gradient-to-l from-violet-500 to-fuchsia-500 text-white hover:from-violet-400 hover:to-fuchsia-400">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إضافة
          </Button>
        </div>

        {/* الصف الثاني — خيارات المزود المخصص */}
        <div className="grid gap-3 sm:grid-cols-[1fr_240px] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="baseurl" className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> رابط API مخصص {isCustom ? <span className="text-amber-300">(إلزامي للمزود المخصص)</span> : <span className="text-slate-500">(اختياري)</span>}
            </Label>
            <Input
              id="baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.provider.com"
              dir="ltr"
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apistyle">نمط التوافق {isCustom ? "" : <span className="text-slate-500">(للمخصص)</span>}</Label>
            <Select value={apiStyle} onValueChange={setApiStyle} dir="rtl" disabled={!isCustom}>
              <SelectTrigger id="apistyle" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kie">توافق kie.ai — Jobs API</SelectItem>
                <SelectItem value="openai">توافق OpenAI — Images/Videos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {message && (
          <p className={`text-sm rounded-md px-3 py-2 border ${message.kind === "error" ? "bg-red-500/10 text-red-300 border-red-400/30" : "bg-emerald-500/10 text-emerald-300 border-emerald-400/30"}`} dir="auto">
            {message.text}
          </p>
        )}

        {loadError && (
          <p className="text-sm text-red-300 bg-red-500/10 border border-red-400/30 rounded-md px-3 py-2" dir="auto">
            تعذر تحميل المفاتيح: {loadError} — راجع لافتة إعداد قاعدة البيانات أعلى الصفحة.
          </p>
        )}

        {/* القائمة */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">المفاتيح ({keys.length})</h3>
          <Button variant="ghost" size="sm" onClick={load} className="text-slate-400 hover:text-slate-200">
            <RefreshCw className="h-4 w-4" /> تحديث
          </Button>
        </div>

        <ScrollArea className="max-h-96">
          <div className="space-y-2 pe-2">
            {loading ? (
              <p className="text-sm text-slate-400 py-6 text-center">جارٍ التحميل…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لبدء التوليد.</p>
            ) : (
              keys.map((k) => (
                <div key={k.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs bg-violet-500/15 text-violet-300 border-violet-400/30" dir="ltr">
                      {PROVIDER_LABEL[k.provider] ?? k.provider}
                    </Badge>
                    {statusBadge(k.status)}
                    {k.label ? <span className="text-sm font-medium text-slate-200">{k.label}</span> : null}
                    <span className="text-xs text-slate-500 ms-auto">{timeAgo(k.created_at)}</span>
                  </div>
                  {k.base_url && (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5" dir="ltr">
                      <Globe className="h-3 w-3" /> <span className="font-mono">{k.base_url}</span>
                      {k.api_style && <span className="rounded bg-white/10 px-1.5 py-0.5">{k.api_style === "openai" ? "OpenAI-compatible" : "kie Jobs API"}</span>}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>الاستخدام: <b className="text-slate-200">{k.usage_count}</b></span>
                    <span>نجاح: <b className="text-emerald-300">{k.success_count}</b></span>
                    <span>فشل: <b className="text-red-300">{k.fail_count}</b></span>
                    <span>آخر استخدام: {timeAgo(k.last_used_at)}</span>
                  </div>
                  {k.last_error && (
                    <p className="text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded px-2 py-1 break-words" dir="auto">آخر خطأ: {k.last_error}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleStatus(k)}
                      disabled={rowBusy === k.id}
                      className="min-h-9 border-white/15 hover:bg-white/10"
                    >
                      {rowBusy === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                      {k.status === "disabled" ? "تنشيط" : "تعطيل"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeKey(k)}
                      disabled={rowBusy === k.id}
                      className="min-h-9 border-white/15 text-red-300 hover:text-red-200 hover:bg-red-500/15"
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
