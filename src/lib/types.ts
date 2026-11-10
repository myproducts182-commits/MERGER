/** الأنواع المشتركة للمشروع */

export type ProviderId = "kie" | "cometapi";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export type KeyStatus = "active" | "exhausted" | "disabled";

/** فئة خطأ المزود — تحدد سلوك التبديل (انظر classifyProviderError) */
export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

/** خطأ موحد من المزود/الخدمة — status قد يكون HTTP أو code داخلي في الجسم */
export class ProviderError extends Error {
  status?: number;
  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

/** محول مزود — واجهة موحدة لكل المزودين */
export interface ProviderAdapter {
  /** مهمة غير متزامنة (فيديو وبعض الصور): تعيد معرّف المهمة لدى المزود */
  createTask(key: string, providerModel: string, input: Record<string, unknown>): Promise<{ providerTaskId: string }>;
  /** صور متزامنة إن كان المزود يدعمها (تعيد الروابط فورًا) */
  createImageSync?(key: string, providerModel: string, input: Record<string, unknown>): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(key: string, providerTaskId: string): Promise<CheckResult>;
}

export interface CheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number;
}

/** سجل محاولة واحدة — يخزن في attempts_json للمهمة */
export interface AttemptRecord {
  provider: string;
  keyId: string;
  keyLabel: string;
  ok: boolean;
  errorClass?: ErrorClass;
  error?: string;
  at: string;
}

/** صف مهمة كما هو في قاعدة البيانات (بعد تحليل JSON) */
export interface TaskRecord {
  id: string;
  provider: TaskProvider | null;
  provider_task_id: string | null;
  key_id: string | null;
  model: string;
  type: MediaType;
  prompt: string;
  params_json: string;
  params: Record<string, unknown>;
  status: TaskStatus;
  progress: number;
  result_urls: string[];
  error_message: string | null;
  attempts: AttemptRecord[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** صف مفتاح API (بدون المفتاح الكامل عند العرض) */
export interface KeyRecord {
  id: string;
  provider: ProviderId;
  label: string;
  api_key: string;
  status: KeyStatus;
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}
