# 🎬 MCP Media Generator

خادم **MCP (Model Context Protocol)** لتوليد الوسائط بالذكاء الاصطناعي — يجمع ثلاث قدرات في أداة واحدة:

1. **توليد صور** من وصف نصي — الموديل المدمج: `gpt-image-2-6/flare-text-to-image`
2. **توليد فيديو** مع صوت متزامن أصلي (حوار/مؤثرات/موسيقى) — الموديل المدمج: `grok-imagine-video-1-5-preview`
3. **دمج عدة مقاطع فيديو** في مقطع واحد عالي الجودة وبالترتيب المطلوب — عبر خدمة Video Merger API v2

التطبيق Next.js واحد فيه جزءان:

- **خادم MCP** على المسار `/mcp` (نقل Streamable HTTP عبر SDK الرسمي) يعرض **5 أدوات** لأي عميل: ChatGPT Connectors / Claude Desktop / Cursor / Windsurf / Cline / GPT Agents SDK.
- **واجهة ويب عربية RTL** لإدارة مفاتيح API، متابعة المهام حية، وعرض إعدادات الربط جاهزة للنسخ.

---

## ✨ المزايا الجوهرية

- **لا يُنزَّل أي ملف وسائط على السيرفر إطلاقًا** — تُخزَّن روابط النتائج فقط في قاعدة البيانات.
- **مفاتيح متعددة بترتيب تسلسلي صارم** حسب ترتيب الإضافة (أول مفتاح يُجرَّب أولًا) — ليس round-robin.
- **تبديل تلقائي فوري عند أي خطأ أو نفاد رصيد دون توقف المهمة** — نفس المهمة تُستأنف بنفس `task_id` على المفتاح التالي، ونموذج الذكاء الاصطناعي **لا يرى أخطاء المفاتيح أو الرصيد أبدًا**.
- **تصنيف أخطاء الموحد**: مفتاح مرفوض (→ تعطيل)، نفاد رصيد (→ علامة exhausted وتبقى في القاعدة)، موديل غير مدعوم، خطأ معطيات (توقف فوري)، مؤقت (انتقال للتابع).
- مهمة فشلت على كل المفاتيح تبقى `processing` («بانتظار توفر مفتاح صالح…») وتُعاد محاولتها تلقائيًا مع كل `get_task` بعد تهدئة ~45 ثانية — بشحن الرصيد تكتمل المهمة من تلقاء نفسها.
- **بث تقدم حي** (Progress notifications) كل ~3 ثوانٍ أثناء نافذة الانتظار.
- التوليد غير متزامن: الأداة تعيد `task_id` فورًا، ويتابَع بـ `get_task` كل ~10 ثوانٍ.
- إخفاء المفاتيح إلزامي في كل الاستجابات والسجلات (`maskKey`).

---

## 🛠 التقنيات

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- `@modelcontextprotocol/sdk` — `McpServer` + `WebStandardStreamableHTTPServerTransport` الرسميان
- `@libsql/client` مع قاعدة **Turso** عبر HTTP (متوافق مع Vercel serverless — بلا ملفات محلية)
- المزودون: **kie.ai** (Jobs API الموحد) + **CometAPI** + خدمة دمج مستقلة

---

## 🚀 التشغيل المحلي

```bash
bun install        # أو npm install
cp .env.example .env.local   # ثم عبّئ القيم الحقيقية
bun run dev        # http://localhost:3000
```

### متغيرات البيئة (`.env.local` محليًا ونفسها على Vercel)

| المتغير | إلزامي | الوصف |
|---|---|---|
| `TURSO_DATABASE_URL` | ✅ | رابط قاعدة Turso مثل `libsql://<db>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | ✅ | توكن Turso بصلاحيات كتابة |
| `MERGER_API_BASE` | للدمج | رابط خدمة الدمج Video Merger API v2 (بلا مفتاح) |
| `MCP_ACCESS_TOKEN` | اختياري | إن ضُبط يُطلب `Authorization: Bearer <token>` على `/mcp` |
| `MCP_MAX_WAIT_SECONDS` | اختياري | سقف نافذة الانتظار داخل الاستدعاء الواحد (الافتراضي 50) |
| `KIE_IMAGE_MODEL` / `KIE_VIDEO_MODEL` / `COMETAPI_IMAGE_MODEL` / `COMETAPI_VIDEO_MODEL` | اختياري | تجاوز أسماء الموديلات لدى كل مزود |

إنشاء قاعدة Turso مجانية:

```bash
turso db create <name>
turso db show <name> --url
turso db tokens create <name>
```

---

## ☁️ النشر على Vercel

1. اربط المستودع في Vercel → **Deploy** (Next.js يُكتشف تلقائيًا، بلا إعدادات إضافية).
2. أضف متغيرات البيئة في **Settings → Environment Variables**:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `MERGER_API_BASE` (إن كانت خدمة الدمج متاحة)
   - `MCP_ACCESS_TOKEN` (اختياري)
3. اختر المنطقة الأقرب لقاعدة Turso (مثلًا `fra1` لقاعدة في أوروبا) من إعدادات المشروع.
4. كل شيء يعمل على serverless: libsql يتصل عبر HTTP ومسار `/mcp` يدعم البث. لا اعتماد على أي ملف محلي.

> ملاحظة حدود المدة: `maxDuration = 60` مضبوط على `/mcp` ليعمل على كل الخطط؛ نافذة الانتظار داخل الاستدعاء مقيّدة بـ `MCP_MAX_WAIT_SECONDS` (افتراضي 50 ثانية) والمتابعة تجري عبر `get_task`. على خطط Pro/Fluid يمكنك رفع الاثنين.

---

## 🔌 ربط العملاء

الرابط: `<origin>/mcp`

**ChatGPT / GPT Agents** (Settings → Connectors → Create → Custom MCP server):

```json
{ "mcpServers": { "media-generator": { "url": "<MCP_URL>" } } }
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{ "mcpServers": { "media-generator": { "type": "http", "url": "<MCP_URL>" } } }
```

**Cursor / Windsurf / Cline** (`mcp.json`): نفس صيغة Claude. وعند ضبط `MCP_ACCESS_TOKEN` أضف `"headers": { "Authorization": "Bearer <token>" }`.

## 🧰 الأدوات الخمس

| الأداة | الوصف |
|---|---|
| `generate_image` | توليد صورة بـ `gpt-image-2-6/flare-text-to-image` مع تبديل تلقائي عبر كل المفاتيح النشطة |
| `generate_video` | توليد فيديو بـ `grok-imagine-video-1-5-preview` (صوت متزامن، image-to-video اختياري) |
| `merge_videos` | دمج 2–10 مقاطع بترتيب معين عبر `urls` مباشرة أو `task_ids` لمهام مكتملة |
| `get_task` | تتبع أي مهمة (توليد أو دمج) بمعرّفها — تحديث حي من المزود/الخدمة |
| `list_media` | أحدث الوسائط المخزنة بروابطها (استرجاع بلا إعادة توليد) |

> ⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — تُذكر هذه الملاحظة في وصف الأداة وتعليمات السيرفر ليُنبّه النموذج المستخدم للتنزيل سريعًا.

---

## 🗄 قاعدة البيانات

جدولان يُنشآن تلقائيًا عند أول وصول (`ensureSchema` — بلا أداة migrations):

- `tasks` — المهام: المزود، معرّف المزود، المفتاح المستخدم، الحالة، التقدم، روابط النتائج، وسجل المحاولات (`attempts_json`).
- `api_keys` — المفاتيح: المزود، الحالة (`active | exhausted | disabled`)، عدّادات الاستخدام/النجاح/الفشل، آخر خطأ.

أدوات مساعدة في `scripts/`:

- `mock-kie.mjs` — خادم وهمي لمحاكاة مفتاح مستنزف (402) وخدمة دمج كاملة للاختبار المحلي.
- `cleanup-test-data.mjs` — تنظيف آثار الاختبار من القاعدة (يتطلب متغيرات البيئة ويستثني المفتاح الحقيقي).

---

## 🔒 ملاحظات أمنية

- `.env*` مستثنى في `.gitignore` منذ اليوم الأول — لا أسرار في Git إطلاقًا، ولا تُطبع مفاتيح كاملة في الردود أو السجلات.
- كل الاستجابات تُخفي المفاتيح (`ABCD123••••••••WXYZ`).
- إذا ضُبط `MCP_ACCESS_TOKEN` فكل نداءات `/mcp` تتطلب الترويسة، وتظهر حالة الحماية في `/api/health` وفي الواجهة.

---

## 🧪 فحص الجهوزية

```bash
curl <origin>/api/health
# {"ok":true,"database":"turso-connected","mcpEndpoint":"/mcp","models":[...],"merger":{...},"authRequired":false}
```
