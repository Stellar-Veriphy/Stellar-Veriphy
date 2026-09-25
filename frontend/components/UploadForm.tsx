"use client";

import { useMemo, useState } from "react";
import {
  SUPPORTED_MEDIA_TYPES,
  UPLOAD_LIMITS,
  errorsByField,
  validateUploadMetadata,
  type ContentManifest,
  type FieldError,
  type VerificationJobView,
} from "@stellarveriphy/shared";
import { useFileHash } from "@/hooks/useFileHash";
import { useJobStatuses } from "@/hooks/useJobStatuses";
import { ApiError, api } from "@/lib/api";
import { trackJob } from "@/lib/tracked-jobs";
import { Field } from "./Field";
import { JobProgress } from "./JobProgress";

// Maps validation paths from the shared schema to the form input that fixes them.
const FIELD_FOR_PATH: Record<string, string> = {
  fileName: "file",
  mimeType: "file",
  fileSize: "file",
  contentHash: "file",
  "manifest.contentHash": "file",
  creator: "creator",
  "manifest.creator": "creator",
  "manifest.timestamp": "capturedAt",
  "manifest.metadata": "device",
  "manifest.metadata.device": "device",
  "manifest.metadata.location": "location",
  "manifest.metadata.aiModel": "aiModel",
  title: "title",
  description: "description",
  tags: "tags",
};

const ACCEPT = Object.entries(SUPPORTED_MEDIA_TYPES).flatMap(([type, exts]) => [type, ...exts]).join(",");

// Value for <input type="datetime-local"> in the user's timezone.
function localDateTimeNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function toIsoTimestamp(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? local : date.toISOString();
}

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState({
    creator: "",
    capturedAt: localDateTimeNow(),
    device: "",
    location: "",
    aiModel: "",
    title: "",
    description: "",
    tags: "",
  });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState<VerificationJobView | null>(null);
  const hashState = useFileHash(file);
  const { jobs } = useJobStatuses(submitted ? [submitted.id] : []);

  const set = (name: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      setServerError(null);
    };
  const touch = (name: string) => () => setTouched((t) => new Set(t).add(name));

  const payload = useMemo(() => {
    const contentHash = hashState.status === "done" ? hashState.hash : "";
    const metadata = { device: values.device, location: values.location, aiModel: values.aiModel };
    const hasMetadata = Object.values(metadata).some((v) => v.trim() !== "");
    const manifest: ContentManifest = {
      contentHash,
      creator: values.creator,
      timestamp: toIsoTimestamp(values.capturedAt),
      ...(hasMetadata ? { metadata } : {}),
    };
    return {
      fileName: file?.name ?? "",
      mimeType: file?.type ?? "",
      fileSize: file?.size ?? 0,
      contentHash,
      creator: values.creator,
      title: values.title,
      description: values.description,
      tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
      manifest,
    };
  }, [file, hashState, values]);

  const validation = useMemo(() => validateUploadMetadata(payload), [payload]);
  const clientErrors: FieldError[] = validation.ok ? [] : validation.errors;
  const allErrors = [...clientErrors, ...(serverError?.errors ?? [])];

  // One message per input. Errors show once the input was touched or a submit was attempted.
  const inputErrors: Record<string, FieldError> = {};
  for (const [path, error] of Object.entries(errorsByField(allErrors))) {
    const input = FIELD_FOR_PATH[path] ?? path;
    if (!inputErrors[input] && (submitAttempted || touched.has(input))) inputErrors[input] = error;
  }

  // With no file, the individual file/hash errors are noise; give one clear instruction.
  if (!file && inputErrors.file) {
    inputErrors.file = { field: "file", message: "Choose a file to upload.", hint: "Its hash becomes the content hash in the manifest." };
  }
  // Hash-related errors are noise while the hash is still being computed.
  if (hashState.status === "hashing") delete inputErrors.file;
  if (hashState.status === "error") {
    inputErrors.file = { field: "file", message: hashState.message };
  }

  const inputProps = (name: string) => ({
    id: name,
    "aria-invalid": !!inputErrors[name],
    "aria-describedby": `${name}-desc`,
    onBlur: touch(name),
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    setServerError(null);
    if (!validation.ok || hashState.status !== "done") {
      const first = clientErrors[0];
      document.getElementById(FIELD_FOR_PATH[first?.field] ?? "file")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const upload = await api.createUpload(validation.value);
      const job = await api.createJob(upload.id);
      trackJob({ id: job.id, label: upload.title ?? upload.fileName, submittedAt: job.createdAt });
      setSubmitted(job);
    } catch (err) {
      setServerError(err instanceof ApiError ? err : new ApiError("Submission failed. Please try again.", 0));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    const job = jobs[submitted.id] ?? submitted;
    return (
      <section className="card">
        <h2>Submitted for verification</h2>
        <JobProgress job={job} />
        <p>
          Track this and earlier submissions on <a href="/creator/jobs">My verification jobs</a>.
        </p>
        <button type="button" className="secondary" onClick={() => window.location.reload()}>Upload another file</button>
      </section>
    );
  }

  // Summary lists one message per input, keyed by the input id so links can jump to it.
  const summaryErrors = Object.entries(submitAttempted || serverError ? inputErrors : {});

  return (
    <form onSubmit={onSubmit} noValidate className="form">
      {(summaryErrors.length > 0 || serverError) && (
        <div className="notice notice-error" role="alert">
          <p><strong>{serverError && serverError.errors.length === 0 ? serverError.message : "Please fix the following before submitting:"}</strong></p>
          {summaryErrors.length > 0 && (
            <ul>
              {summaryErrors.map(([input, error]) => (
                <li key={input}>
                  <a href={`#${input}`}>{error.message}</a>
                  {error.hint && <span className="hint"> {error.hint}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <fieldset>
        <legend>Content</legend>
        <Field
          id="file"
          label="Media file"
          help={`Images, video, audio or PDF up to ${UPLOAD_LIMITS.maxFileSizeBytes / (1024 * 1024)} MB. The file is hashed in your browser.`}
          error={inputErrors.file}
        >
          <input
            type="file"
            accept={ACCEPT}
            {...inputProps("file")}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              touch("file")();
              setServerError(null);
            }}
          />
        </Field>
        {hashState.status === "hashing" && <p className="muted">Computing SHA-256 hash…</p>}
        {hashState.status === "done" && (
          <p className="muted">SHA-256: <code className="hash">{hashState.hash}</code></p>
        )}
        <Field id="title" label="Title (optional)" error={inputErrors.title}>
          <input type="text" value={values.title} onChange={set("title")} maxLength={UPLOAD_LIMITS.titleMaxLength} {...inputProps("title")} />
        </Field>
        <Field id="description" label="Description (optional)" error={inputErrors.description}>
          <textarea value={values.description} onChange={set("description")} rows={3} {...inputProps("description")} />
        </Field>
        <Field id="tags" label="Tags (optional)" help="Separate tags with commas." error={inputErrors.tags}>
          <input type="text" value={values.tags} onChange={set("tags")} {...inputProps("tags")} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Manifest</legend>
        <Field id="creator" label="Creator public key" help="Your Stellar address, starting with G." error={inputErrors.creator}>
          <input
            type="text"
            value={values.creator}
            onChange={set("creator")}
            autoComplete="off"
            spellCheck={false}
            placeholder="G…"
            {...inputProps("creator")}
          />
        </Field>
        <Field id="capturedAt" label="Created at" help="When the content was captured or made." error={inputErrors.capturedAt}>
          <input type="datetime-local" value={values.capturedAt} onChange={set("capturedAt")} {...inputProps("capturedAt")} />
        </Field>
        <Field id="device" label="Device (optional)" error={inputErrors.device}>
          <input type="text" value={values.device} onChange={set("device")} {...inputProps("device")} />
        </Field>
        <Field id="location" label="Location (optional)" error={inputErrors.location}>
          <input type="text" value={values.location} onChange={set("location")} {...inputProps("location")} />
        </Field>
        <Field id="aiModel" label="AI model (optional)" help="If AI was used to generate or edit the content, name the model." error={inputErrors.aiModel}>
          <input type="text" value={values.aiModel} onChange={set("aiModel")} {...inputProps("aiModel")} />
        </Field>
      </fieldset>

      <button type="submit" disabled={submitting || hashState.status === "hashing"}>
        {submitting ? "Submitting…" : hashState.status === "hashing" ? "Hashing file…" : "Submit for verification"}
      </button>
    </form>
  );
}
