#!/usr/bin/env node
/**
 * خادم وهمي لاختبار سيناريو المفتاح المستنزف (402) — معيار القبول 7.
 * - المفتاح "EXHAUSTED-TEST-KEY-402" يجيب دائمًا 402 insufficient balance.
 * - أي مفتاح آخر: يُمرَّر الطلب إلى kie.ai الحقيقي (بروكسي شفاف) حتى يكتمل التوليد فعليًا.
 * استخدام: node scripts/mock-kie.mjs [port=9979]
 */
import http from "node:http";

const REAL = "https://api.kie.ai";
const EXHAUSTED = "EXHAUSTED-TEST-KEY-402";
const PORT = Number(process.argv[2] || 9979);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function proxy(req, res, body) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  const opts = {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  };
  fetch(REAL + req.url, opts)
    .then(async (up) => {
      const text = await up.text();
      res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") || "application/json" });
      res.end(text);
    })
    .catch((e) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    });
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  const body = await readBody(req);
  console.log(`[mock-kie] ${req.method} ${req.url} key=${key.slice(0, 8)}…`);

  // ——— محاكاة خدمة الدمج Video Merger API v2 (بنفس أشكال المواصفة المقاسة) ———
  if (req.url === "/api/config" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ maxClips: 10, maxInputMb: 200, maxOutputMb: 150, maxTotalSeconds: 600, retentionHours: 24 }));
    return;
  }
  const jobMatch = req.url.match(/^\/api\/jobs\/([\w-]+)(\/process|\/video)?$/);
  if (req.url === "/api/jobs" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jobId: "mockjob001",
      status: "queued",
      statusUrl: `http://localhost:${PORT}/api/jobs/mockjob001`,
      processUrl: `http://localhost:${PORT}/api/jobs/mockjob001/process`,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }));
    return;
  }
  if (jobMatch) {
    const id = jobMatch[1];
    const action = jobMatch[2];
    if (action === "/process" && req.method === "POST") {
      // يستغرق ~10-15 ثانية (blocking) كالخدمة الحقيقية
      await new Promise((r) => setTimeout(r, 12_000));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "done",
        videoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
        downloadUrl: `http://localhost:${PORT}/api/jobs/${id}/video?download=1`,
        size: 1234567,
        duration: 30.2,
        resolution: "640x360",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }));
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET") {
      // تقدم تدريجي: queued → processing → done
      const started = jobStart.get(id) || Date.now();
      jobStart.set(id, started);
      const elapsed = (Date.now() - started) / 1000;
      let payload;
      if (elapsed < 6) {
        payload = { status: "queued", progress: 0.2 };
      } else if (elapsed < 14) {
        payload = { status: "processing", progress: 55 };
      } else {
        payload = {
          status: "done",
          progress: 1,
          videoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
          downloadUrl: `http://localhost:${PORT}/api/jobs/${id}/video?download=1`,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
  }

  if (key === EXHAUSTED && req.url.startsWith("/api/v1/jobs/createTask")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 402, msg: "insufficient balance: not enough credits (mock)", data: null }));
    return;
  }
  proxy(req, res, body);
});

const jobStart = new Map();

server.listen(PORT, () => console.log(`[mock-kie] listening on http://localhost:${PORT}`));
