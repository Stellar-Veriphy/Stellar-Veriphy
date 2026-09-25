import type { FieldError, UploadMetadata, UploadRecord, VerificationJobView } from "@stellarveriphy/shared";

export class ApiError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly errors: FieldError[] = []) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.message ?? `Request failed (${res.status}).`, res.status, body?.errors ?? []);
  }
  return body.data as T;
}

function postJson<T>(url: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export const api = {
  createUpload: (metadata: UploadMetadata) => postJson<UploadRecord>("/api/uploads", metadata),
  findUploadsByHash: (contentHash: string) =>
    request<UploadRecord[]>(`/api/uploads?contentHash=${encodeURIComponent(contentHash)}`),
  getUpload: (id: string) => request<UploadRecord>(`/api/uploads/${encodeURIComponent(id)}`),
  createJob: (uploadId: string) => postJson<VerificationJobView>("/api/jobs", { uploadId }),
  getJobs: (ids: string[]) =>
    request<VerificationJobView[]>(`/api/jobs?ids=${ids.map(encodeURIComponent).join(",")}`),
};
