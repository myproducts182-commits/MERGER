/**
 * بناء خادم MCP — الأدوات الخمس بأوصافها الإنجليزية (يقرأها العميل)، أما نتائج الاستدعاء فعربية.
 * SERVER_INSTRUCTIONS تُرسل مع initialize كما هي.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runGeneration, refreshTask, runMerge, listMedia, type ToolResult } from "./orchestrator";
import type { MediaType } from "./types";

export const SERVER_INFO = { name: "media-generator-mcp", version: "1.2.0" } as const;

export const SERVER_INSTRUCTIONS = `AI media generation server (kie.ai + CometAPI with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
Use list_media to recall previously generated media from the database.`;

type ToolResponse = ToolResult;

/** يلفّ دالة الأداة مع بث تقدم حي عبر progress notifications إن زوّد العميل الطلب بـ progressToken */
function withProgress(
  handler: (args: Record<string, never>, send: (p: number, msg: string) => Promise<void>) => Promise<ToolResponse>,
) {
  return async (args: Record<string, never>, extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: unknown) => Promise<void> }): Promise<ToolResponse> => {
    const token = extra?._meta?.progressToken;
    const send = token !== undefined
      ? async (progress: number, message: string) => {
          await extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken: token, progress, total: 100, message },
          });
        }
      : async () => {};
    return handler(args, send);
  };
}

export function buildMediaServer(): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  // 1) generate_image
  server.registerTool(
    "generate_image",
    {
      description:
        "Generate an image with gpt-image-2-6/flare-text-to-image (automatic failover across all active keys in strict order). " +
        "Returns the ready image URL if generation completes within the wait window; otherwise returns a task_id — " +
        "call get_task with it every ~10 seconds until status is completed (then show the URL and stop) or failed (explain why).",
      inputSchema: {
        prompt: z.string().min(1).describe("What to draw. Detailed prompts give better results."),
        model: z.enum(["gpt-image-2-6/flare-text-to-image", "gpt-image-2.6/flare-text-to-image"]).default("gpt-image-2-6/flare-text-to-image"),
        aspect_ratio: z.enum(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"]).default("auto"),
        resolution: z.enum(["1K", "2K", "4K"]).default("1K"),
        background: z.enum(["auto", "transparent", "opaque"]).default("auto").describe("Only applied at 1K."),
        output_format: z.enum(["png", "jpeg", "webp", "gif"]).default("png"),
        wait_seconds: z.number().int().min(0).max(240).default(90),
      },
    },
    withProgress(async (args, send) => {
      return runGeneration({ type: "image", args: args as unknown as Record<string, unknown>, sendProgress: send });
    }) as never,
  );

  // 2) generate_video
  server.registerTool(
    "generate_video",
    {
      description:
        "Generate a video with grok-imagine-video-1-5-preview (native synchronized audio — dialogue, sfx, music — with optional image-to-video). " +
        "Video takes minutes: a short wait streams live progress, then a task_id is returned — track it with get_task every ~10 seconds.",
      inputSchema: {
        prompt: z.string().max(4096).describe("Scene description. Dialogue in the prompt is spoken in the video."),
        image_url: z.string().optional().describe("Optional public image URL as the first frame (image-to-video)."),
        model: z.enum(["grok-imagine-video-1-5-preview", "grok-imagine-video-1.5-preview"]).default("grok-imagine-video-1-5-preview"),
        aspect_ratio: z.enum(["auto", "1:1", "16:9", "9:16", "3:2", "2:3"]).default("auto"),
        resolution: z.enum(["480p", "720p", "1080p"]).default("480p"),
        enable_audio: z.boolean().default(true),
        duration: z.number().int().min(1).max(15).default(8).describe("Duration in seconds."),
        wait_seconds: z.number().int().min(0).max(240).default(25),
      },
    },
    withProgress(async (args, send) => {
      return runGeneration({ type: "video", args: args as unknown as Record<string, unknown>, sendProgress: send });
    }) as never,
  );

  // 3) merge_videos — الحدود 2..10 في المخطط، ورسائل الرفض عربية (نفس النص مطبّق داخل المنسّق كطبقة ثانية)
  server.registerTool(
    "merge_videos",
    {
      description:
        "Merge several clips into ONE final video in the given order. Pass 'urls' (public direct video URLs — e.g. links returned by generate_video) " +
        "or 'task_ids' (completed video generation tasks — their result URLs are resolved from the database in this order; ideal after generating several clips). " +
        "Merging is usually fast: a short wait streams live progress, then a task_id for the merge — track it with get_task. " +
        "The merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.",
      inputSchema: {
        urls: z.array(z.string()).min(2, { message: "❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة." })
          .max(10, { message: "❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى)." })
          .optional()
          .describe("Public direct video URLs (http/https) in merge order — the first clip starts the final video."),
        task_ids: z.array(z.string()).min(2, { message: "❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة." })
          .max(10, { message: "❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى)." })
          .optional()
          .describe("Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order."),
        wait_seconds: z.number().int().min(0).max(240).default(60),
      },
    },
    withProgress(async (args, send) => {
      return runMerge({ args: args as unknown as Record<string, unknown>, sendProgress: send });
    }) as never,
  );

  // 4) get_task
  server.registerTool(
    "get_task",
    {
      description:
        "Track any task by its id — image/video generation AND merging (reads the database and refreshes live from the provider/merging service while processing). " +
        "Poll it every ~10 seconds; when completed the result URLs are included — show them to the user and stop polling.",
      inputSchema: {
        task_id: z.string().describe("The task id returned by generate_image / generate_video / merge_videos."),
      },
    },
    (async (args: { task_id: string }) => refreshTask(args.task_id)) as never,
  );

  // 5) list_media
  server.registerTool(
    "list_media",
    {
      description:
        "Latest stored images/videos/merges with their result URLs from the database (no regeneration) — recall previous results.",
      inputSchema: {
        type: z.enum(["image", "video", "merge"]).optional(),
        status: z.enum(["completed", "failed", "processing"]).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    (async (args: { type?: MediaType; status?: "completed" | "failed" | "processing"; limit?: number }) =>
      listMedia({ type: args.type, status: args.status, limit: args.limit })) as never,
  );

  return server;
}
