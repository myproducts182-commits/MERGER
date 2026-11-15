"use client";

/**
 * بطاقة ربط السيرفر: رابط <origin>/mcp جاهز للنسخ + JSON لكل عميل (ChatGPT / Claude Desktop / Cursor)
 + رقائق الأدوات الخمس + ملاحظة الفيديو.
 */
import { useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Image as ImageIcon, Film, Layers, Search, ListVideo } from "lucide-react";
import type { HealthInfo } from "./types";

const TOOLS: Array<{ name: string; desc: string; icon: React.ReactNode }> = [
  { name: "generate_image", desc: "توليد صورة بأي موديل يدعمه مزودك (تبديل تلقائي عبر كل المفاتيح)", icon: <ImageIcon className="h-4 w-4" /> },
  { name: "generate_video", desc: "توليد فيديو بأي موديل مدعوم مع صوت متزامن أصلي (حوار/مؤثرات/موسيقى)", icon: <Film className="h-4 w-4" /> },
  { name: "merge_videos", desc: "دمج عدة مقاطع في فيديو واحد نهائي بالترتيب المطلوب", icon: <Layers className="h-4 w-4" /> },
  { name: "get_task", desc: "تتبع حالة أي مهمة (توليد أو دمج) بمعرّفها", icon: <Search className="h-4 w-4" /> },
  { name: "list_media", desc: "استرجاع أحدث الوسائط المخزنة بروابطها", icon: <ListVideo className="h-4 w-4" /> },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-9"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // متصفح بلا صلاحية clipboard — تجاهل
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      {copied ? "تم النسخ" : label ?? "نسخ"}
    </Button>
  );
}

function JsonBlock({ value }: { value: string }) {
  return (
    <pre dir="ltr" className="text-left text-xs leading-relaxed bg-black/40 border border-white/10 text-slate-200 rounded-lg p-4 overflow-x-auto font-mono whitespace-pre">
      {value}
    </pre>
  );
}

export default function ConnectCard({ health }: { health: HealthInfo | null }) {
  // يقرأ origin في المتصفح فقط (خادمًا يعيد نصًا فارغًا) — بلا حالة ولا مضافات مائية
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const mcpUrl = `${origin}/mcp`;
  /** ChatGPT لا يدعم ترويسات مخصصة في موصلاته — المفتاح يوضع في الرابط نفسه ?key=… */
  const chatgptMcpUrl = health?.authRequired ? `${mcpUrl}?key=<MCP_ACCESS_TOKEN>` : mcpUrl;
  const authHeaders = health?.authRequired ? { Authorization: `Bearer <MCP_ACCESS_TOKEN>` } : undefined;

  // JSON جاهز لكل عميل — يتضمن Authorization فقط عند ضبط MCP_ACCESS_TOKEN (المترجم يخزّن الحسابات تلقائيًا)
  const serverEntry = { url: mcpUrl, ...(authHeaders ? { headers: authHeaders } : {}) };
  const chatgptJson = JSON.stringify({ mcpServers: { "media-generator": { url: chatgptMcpUrl } } }, null, 2);
  const claudeJson = JSON.stringify({ mcpServers: { "media-generator": { type: "http", ...serverEntry } } }, null, 2);
  const cursorJson = claudeJson;

  return (
    <Card className="border-white/10 shadow-xl shadow-black/25 backdrop-blur" dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">🔌 ربط السيرفر</CardTitle>
        <CardDescription>انسخ رابط نقطة MCP وأضفه لأي عميل مدعوم — الخادم يتحدث بروتوكول MCP Streamable HTTP.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* الرابط المطلق */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Input readOnly value={mcpUrl} dir="ltr" className="font-mono text-sm bg-black/30 border-white/10" aria-label="رابط MCP" />
          <CopyButton text={mcpUrl} label="نسخ الرابط" />
        </div>

        {/* تبويبات العملاء */}
        <Tabs defaultValue="chatgpt" dir="rtl">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto">
            <TabsTrigger value="chatgpt">ChatGPT / GPT Agents</TabsTrigger>
            <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
            <TabsTrigger value="cursor">Cursor / Windsurf / Cline</TabsTrigger>
          </TabsList>

          <TabsContent value="chatgpt" className="space-y-2 pt-3">
            <JsonBlock value={chatgptJson} />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-slate-400" dir="auto">
                في ChatGPT: Settings → Connectors → Create → Custom MCP server وضع الرابط في «Server URL» واختر Authentication: No authentication.
              </p>
              <CopyButton text={chatgptJson} />
            </div>
            {health?.authRequired && (
              <p className="text-xs bg-cyan-500/10 text-cyan-200 border border-cyan-400/30 rounded px-3 py-2 leading-relaxed">
                مهم لـ ChatGPT: موصلاته المخصصة لا تدعم ترويسات مصادقة مخصصة — لذلك يوضع المفتاح داخل الرابط نفسه
                (<span dir="ltr" className="font-mono">/mcp?key=…</span>) كما في JSON أعلاه. البديل: احذف متغير
                <span dir="ltr" className="font-mono"> MCP_ACCESS_TOKEN</span> من Vercel (Settings → Environment Variables ثم Redeploy) واختر No authentication بلا مفتاح.
              </p>
            )}
          </TabsContent>

          <TabsContent value="claude" className="space-y-2 pt-3">
            <JsonBlock value={claudeJson} />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-slate-400" dir="auto">
                أضفه إلى ملف claude_desktop_config.json ثم أعد تشغيل التطبيق.
              </p>
              <CopyButton text={claudeJson} />
            </div>
          </TabsContent>

          <TabsContent value="cursor" className="space-y-2 pt-3">
            <JsonBlock value={cursorJson} />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-slate-400" dir="auto">
                أضفه إلى mcp.json في Cursor / Windsurf / Cline ثم حدّث قائمة MCP.
              </p>
              <CopyButton text={cursorJson} />
            </div>
          </TabsContent>
        </Tabs>

        {health?.authRequired && (
          <p className="text-xs bg-amber-500/10 text-amber-200 border border-amber-400/30 rounded px-3 py-2 leading-relaxed">
            الحماية مفعلة بـ MCP_ACCESS_TOKEN — المفتاح يُقبل بأي شكل: ترويسة
            <span dir="ltr" className="font-mono"> Authorization: Bearer</span> أو
            <span dir="ltr" className="font-mono"> x-api-key</span>، أو داخل الرابط
            (<span dir="ltr" className="font-mono">/mcp?key=…</span>). استبدل
            <span dir="ltr" className="font-mono">&lt;MCP_ACCESS_TOKEN&gt;</span> في JSON أعلاه بالقيمة الفعلية —
            وعميلات Claude/Cursor تُرسل الترويسة تلقائيًا.
          </p>
        )}

        {/* رقائق الأدوات */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2">الأدوات الخمس المتاحة عبر MCP</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {TOOLS.map((t) => (
              <div key={t.name} className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="mt-0.5 text-violet-300">{t.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-mono font-medium text-slate-200" dir="ltr">{t.name}</div>
                  <div className="text-xs text-slate-400">{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ملاحظة كهرمانية */}
        <p className="text-sm bg-amber-500/10 text-amber-200 border border-amber-400/30 rounded-lg px-3 py-2 leading-relaxed">
          ⚠️ الفيديو يحتاج دقائق: يعيد السيرفر task_id فورًا، ويتابع تلقائيًا بـ get_task كل 10 ثوانٍ — وعند اكتمال المهمة يُعرض الرابط في الدردشة ويتوقف.
          أثناء الانتظار يُبَث تقدم حي (Progress notifications) حتى لا تنقطع العملية.
        </p>
      </CardContent>
    </Card>
  );
}
