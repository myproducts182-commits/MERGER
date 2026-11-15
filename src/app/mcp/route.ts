/**
 * مسار /mcp — خادم MCP عبر Streamable HTTP (SDK الرسمي).
 * - POST: رسائل JSON-RPC (initialize / tools/list / tools/call ...) — DELETE: إنهاء الجلسة.
 * - وضع الحالة (sessions) بخريطة عامة تظل حية ما دامت العملية دافئة؛ وعند بداية باردة على Vercel
 *   (جلسة غير معروفة) نخدم الطلب الواحد بوضع stateless حتى لا يتوقف أي عميل أبدًا.
 * - إجابات POST بتدفق SSE (الافتراضي) ليصل بث التقدم حيًا أثناء توليد الوسائط.
 * - إذا ضُبط MCP_ACCESS_TOKEN يُطلب المفتاح بأحد الأشكال: Authorization: Bearer / x-api-key /
 *   x-mcp-token أو ?key=<token> في الرابط (لدعم ChatGPT الذي لا يرسل ترويسات مخصصة).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMediaServer } from "@/lib/mcp-server";
import { isMcpAuthRequired, mcpAccessToken } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// حد مدة الدالة — ارفعه (مثلًا 300) على خطط Pro/Fluid إن أردت نوافذ انتظار أطول داخل الاستدعاء الواحد
export const maxDuration = 60;

interface SessionPair {
  server: ReturnType<typeof buildMediaServer>;
  transport: WebStandardStreamableHTTPServerTransport;
}

/** خريطة الجلسات على مستوى العملية (تبقى حية بين الطلبات ما دامت العملية دافئة) */
const g = globalThis as unknown as Record<string, unknown>;
const sessions: Map<string, SessionPair> = (g.__mcpSessions as Map<string, SessionPair>) ?? new Map<string, SessionPair>();
g.__mcpSessions = sessions;

/** إنشاء ثنائي server+transport جديد وربطه */
async function createPair(stateful: boolean): Promise<SessionPair> {
  const server = buildMediaServer();
  const pair: SessionPair = { server: undefined as never, transport: undefined as never };

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: stateful ? () => randomUUID() : undefined,
    onsessioninitialized: (sessionId) => {
      if (stateful) sessions.set(sessionId, pair);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
    enableJsonResponse: false, // SSE responses → بث التقدم الحي يعمل
    enableDnsRebindingProtection: false,
  });

  pair.server = server;
  pair.transport = transport;
  await server.connect(transport);
  return pair;
}

/** تنظيف الثنائي (transport + server) بأمان */
async function cleanupPair(pair: SessionPair): Promise<void> {
  try {
    await pair.transport.close();
  } catch {
    // تجاهل
  }
  try {
    await pair.server.close();
  } catch {
    // تجاهل
  }
}

/**
 * في الوضع stateless (جلسة غير معروفة / بداية باردة): نعيد الاستجابة ونؤجل إغلاق الثنائي
 * حتى ينتهي جسم البث فعليًا — وإلا يُقطع التدفق قبل وصول النتيجة.
 */
function finalizeStateless(pair: SessionPair, response: Response): Response {
  if (!response.body) {
    void cleanupPair(pair);
    return response;
  }
  const [toClient, toSink] = response.body.tee();
  const done = () => {
    void cleanupPair(pair);
  };
  void toSink
    .pipeTo(new WritableStream({ write() {} }))
    .then(done, done);
  return new Response(toClient, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: مطلوب مفتاح الوصول بأحد هذه الأشكال — Authorization: Bearer <MCP_ACCESS_TOKEN> أو ترويسة x-api-key أو x-mcp-token أو ?key=<MCP_ACCESS_TOKEN> في الرابط",
      },
      id: null,
    },
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * استخراج مفتاح الوصول من أي صيغة يدعمها العملاء:
 * - Authorization: Bearer <token> (Claude / Cursor / Codex)
 * - ترويسة x-api-key أو x-mcp-token
 * - ?key=<token> أو ?token=<token> في الرابط نفسه — الحل الوحيد لـ ChatGPT
 *   (موصلاته المخصصة لا تدعم ترويسات مخصصة، والرابط يُرسل كما هو)
 */
function extractAccessToken(request: NextRequest): string {
  const auth = (request.headers.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  for (const h of ["x-api-key", "x-mcp-token"]) {
    const v = (request.headers.get(h) || "").trim();
    if (v) return v;
  }
  const q = request.nextUrl.searchParams;
  return (q.get("key") || q.get("token") || "").trim();
}

function checkAuth(request: NextRequest): boolean {
  if (!isMcpAuthRequired()) return true;
  const provided = extractAccessToken(request);
  return provided.length > 0 && provided === mcpAccessToken();
}

async function handle(request: NextRequest): Promise<Response> {
  if (!checkAuth(request)) return unauthorized();

  const method = request.method;

  // DELETE: إنهاء الجلسة المعروفة؛ غير معروفة → 404
  if (method === "DELETE") {
    const sid = request.headers.get("mcp-session-id");
    const pair = sid ? sessions.get(sid) : undefined;
    if (!pair) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    const res = await pair.transport.handleRequest(request);
    sessions.delete(sid as string);
    return res;
  }

  if (method === "POST") {
    // نقرأ الجسم مرة واحدة ونمرره مُحللًا (parsedBody) للنقل
    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      parsedBody = undefined;
    }
    const sid = request.headers.get("mcp-session-id");
    const isInitialize = !!parsedBody && typeof parsedBody === "object" && (parsedBody as { method?: string }).method === "initialize";

    if (isInitialize) {
      // كل initialize يفتح جلسة جديدة تُخزن في الخريطة
      const pair = await createPair(true);
      return pair.transport.handleRequest(request, { parsedBody });
    }

    if (sid && sessions.has(sid)) {
      const pair = sessions.get(sid) as SessionPair;
      return pair.transport.handleRequest(request, { parsedBody });
    }

    // جلسة غير معروفة (بداية باردة على Vercel) أو طلب بلا جلسة — نخدم الطلب الواحد بوضع stateless
    const pair = await createPair(false);
    try {
      const response = await pair.transport.handleRequest(request, { parsedBody });
      return finalizeStateless(pair, response);
    } catch (err) {
      await cleanupPair(pair);
      throw err;
    }
  }

  // GET: قناة SSE مستقلة للإشعارات (تتطلب جلسة صالحة)
  if (method === "GET") {
    const sid = request.headers.get("mcp-session-id");
    const pair = sid ? sessions.get(sid) : undefined;
    if (!pair) {
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return pair.transport.handleRequest(request);
  }

  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
    { status: 405, headers: { "Content-Type": "application/json" } },
  );
}

export async function POST(request: NextRequest) {
  return handle(request);
}
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function DELETE(request: NextRequest) {
  return handle(request);
}
