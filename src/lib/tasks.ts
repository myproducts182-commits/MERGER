/**
 * عمليات المهام على Turso — insertTask / getTask / updateTask / listRecentTasks / taskStats.
 * updateTask يطبّق patch جزئيًا، يضيف محاولات إلى attempts_json، ويضبط completed_at تلقائيًا عند الاكتمال.
 */
import { query } from "./turso";
import type { AttemptRecord, MediaType, TaskRecord, TaskStatus } from "./types";

function rowToTask(r: Record<string, unknown>): TaskRecord {
  const parseJson = <T>(v: unknown, fallback: T): T => {
    if (typeof v !== "string" || v === "") return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(r.id),
    provider: (r.provider as TaskRecord["provider"]) ?? null,
    provider_task_id: (r.provider_task_id as string) ?? null,
    key_id: (r.key_id as string) ?? null,
    model: String(r.model ?? ""),
    type: r.type as MediaType,
    prompt: String(r.prompt ?? ""),
    params_json: String(r.params_json ?? "{}"),
    params: parseJson<Record<string, unknown>>(r.params_json, {}),
    status: r.status as TaskStatus,
    progress: Number(r.progress ?? 0),
    result_urls: parseJson<string[]>(r.result_urls_json, []),
    error_message: (r.error_message as string) ?? null,
    attempts: parseJson<AttemptRecord[]>(r.attempts_json, []),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    completed_at: (r.completed_at as string) ?? null,
  };
}

function rowToObj(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(r)) out[k] = r[k];
  return out;
}

export async function insertTask(t: {
  id: string;
  type: MediaType;
  model: string;
  prompt?: string;
  params_json?: string;
  provider?: string | null;
  provider_task_id?: string | null;
  key_id?: string | null;
  status?: TaskStatus;
}): Promise<void> {
  await query(
    `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status, progress, attempts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]')`,
    [t.id, t.provider ?? null, t.provider_task_id ?? null, t.key_id ?? null, t.model, t.type, t.prompt ?? "", t.params_json ?? "{}", t.status ?? "processing"],
  );
}

export async function getTask(taskId: string): Promise<TaskRecord | null> {
  const rs = await query("SELECT * FROM tasks WHERE id = ? LIMIT 1", [taskId]);
  if (rs.rows.length === 0) return null;
  return rowToTask(rowToObj(rs.rows[0]));
}

export interface TaskPatch {
  status?: TaskStatus;
  progress?: number;
  provider?: string | null;
  provider_task_id?: string | null;
  key_id?: string | null;
  result_urls?: string[] | null;
  error_message?: string | null;
  /** محاولة جديدة تُضاف إلى attempts_json */
  append_attempt?: AttemptRecord;
}

export async function updateTask(taskId: string, patch: TaskPatch): Promise<void> {
  // ملاحظة: دمج attempts يتم بقراءة-كتابة؛ الاستخدام لدينا أحادي الكاتب لكل مهمة عمليًا.
  let attemptsJson: string | null = null;
  if (patch.append_attempt) {
    const current = await query("SELECT attempts_json FROM tasks WHERE id = ?", [taskId]);
    const list: AttemptRecord[] = current.rows[0]?.attempts_json
      ? (() => {
          try {
            return JSON.parse(String(current.rows[0].attempts_json)) as AttemptRecord[];
          } catch {
            return [];
          }
        })()
      : [];
    list.push(patch.append_attempt);
    // نحتفظ بآخر 40 محاولة فقط لتفادي النمو غير المحدود
    attemptsJson = JSON.stringify(list.slice(-40));
  }

  const sets: string[] = ["updated_at = datetime('now')"];
  const args: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
    if (patch.status === "completed") {
      sets.push("completed_at = COALESCE(completed_at, datetime('now'))");
    }
  }
  if (patch.progress !== undefined) {
    sets.push("progress = ?");
    args.push(Math.max(0, Math.min(100, Math.round(patch.progress))));
  }
  if (patch.provider !== undefined) {
    sets.push("provider = ?");
    args.push(patch.provider);
  }
  if (patch.provider_task_id !== undefined) {
    sets.push("provider_task_id = ?");
    args.push(patch.provider_task_id);
  }
  if (patch.key_id !== undefined) {
    sets.push("key_id = ?");
    args.push(patch.key_id);
  }
  if (patch.result_urls !== undefined) {
    sets.push("result_urls_json = ?");
    args.push(patch.result_urls === null ? null : JSON.stringify(patch.result_urls));
  }
  if (patch.error_message !== undefined) {
    sets.push("error_message = ?");
    args.push(patch.error_message);
  }
  if (attemptsJson !== null) {
    sets.push("attempts_json = ?");
    args.push(attemptsJson);
  }
  args.push(taskId);
  await query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, args as never[]);
}

export interface TaskFilters {
  type?: MediaType;
  status?: TaskStatus;
}

export async function listRecentTasks(limit = 20, filters: TaskFilters = {}): Promise<TaskRecord[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.type) {
    where.push("type = ?");
    args.push(filters.type);
  }
  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  }
  const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  args.push(Math.max(1, Math.min(50, limit)));
  const rs = await query(sql, args as never[]);
  return rs.rows.map((r) => rowToTask(rowToObj(r)));
}

export interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  processing: number;
}

export async function taskStats(): Promise<TaskStats> {
  const rs = await query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
       COALESCE(SUM(CASE WHEN status IN ('processing','pending') THEN 1 ELSE 0 END), 0) AS processing
     FROM tasks`,
  );
  const r = rs.rows[0];
  return {
    total: Number(r?.total ?? 0),
    completed: Number(r?.completed ?? 0),
    failed: Number(r?.failed ?? 0),
    processing: Number(r?.processing ?? 0),
  };
}
