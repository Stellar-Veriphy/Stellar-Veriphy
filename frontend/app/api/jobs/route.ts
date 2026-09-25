import { isPlainObject, type VerificationJobView } from "@stellarveriphy/shared";
import { readJson, respond, serverError } from "@/lib/server/http";
import { enqueueJob, getJobViews } from "@/lib/server/jobs";
import { getUpload } from "@/lib/server/uploads";

const MAX_IDS_PER_REQUEST = 50;

// POST /api/jobs { uploadId }: queue a verification job for a stored upload.
export async function POST(req: Request) {
  const parsed = await readJson(req);
  if ("response" in parsed) return parsed.response;

  const uploadId = isPlainObject(parsed.body) ? parsed.body.uploadId : undefined;
  if (typeof uploadId !== "string" || uploadId === "") {
    return respond(422, {
      status: "validation_error",
      errors: [{ field: "uploadId", message: "uploadId is required.", hint: "Register the upload with POST /api/uploads first." }],
    });
  }

  try {
    if (!(await getUpload(uploadId))) {
      return respond(404, { status: "not_found", message: "No upload exists with this ID." });
    }
    const job = await enqueueJob(uploadId);
    const [view] = await getJobViews([job.id]);
    return respond<VerificationJobView>(202, { status: "queued", data: view });
  } catch (err) {
    return serverError("POST /api/jobs", err);
  }
}

// GET /api/jobs?ids=a,b,c: current state of several jobs. Unknown IDs are omitted.
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return respond(422, {
      status: "validation_error",
      errors: [{ field: "ids", message: `At most ${MAX_IDS_PER_REQUEST} job IDs can be requested at once.` }],
    });
  }

  try {
    return respond<VerificationJobView[]>(200, { status: "ok", data: await getJobViews(ids) });
  } catch (err) {
    return serverError("GET /api/jobs", err);
  }
}
