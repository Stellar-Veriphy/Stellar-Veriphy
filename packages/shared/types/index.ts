export interface ContentManifest {
  schemaVersion?: string; // semantic version string (e.g. 1.0.0, 2.0.0)
  contentHash: string; // sha256 of the media file
  creator: string; // Stellar public key (G...)
  timestamp: string; // ISO 8601
  metadata?: {
    device?: string;
    location?: string;
    aiModel?: string;
  };
  media?: {
    fileName?: string;
    fileType?: string;
    fileSizeBytes?: number;
  };
}

export interface ProvenanceCert {
  id: string;
  storageRef: string;
  manifestHash: string;
  attestationHash: string;
  creator: string;
  timestamp: number;
}

export type VerificationStatus = "pending" | "processing" | "certified" | "failed";

// ---------------------------------------------------------------------------
// Verification mode
// ---------------------------------------------------------------------------

/** Which verification path the user has chosen. */
export type VerificationMode = "standard" | "advanced";

// ---------------------------------------------------------------------------
// Wallet connection status
// ---------------------------------------------------------------------------

/** Current state of the Freighter wallet connection. */
export type WalletConnectionStatus = "disconnected" | "connecting" | "connected";

// ---------------------------------------------------------------------------
// CertificateDetails — mirrors the on-chain ProvenanceCert struct
// ---------------------------------------------------------------------------

/**
 * Frontend representation of a minted provenance certificate.
 * Field names are camelCase equivalents of the Soroban `ProvenanceCert` struct.
 */
export interface CertificateDetails {
  /** Auto-incrementing on-chain certificate identifier (u64 on-chain). */
  id: string;
  /** IPFS / Arweave storage reference for the original media file. */
  storageRef: string;
  /** SHA-256 hex digest of the manifest JSON. */
  manifestHash: string;
  /** SHA-256 hex digest of the TEE attestation payload. */
  attestationHash: string;
  /** Stellar public key of the content creator. */
  creator: string;
  /** Ledger timestamp (seconds since Unix epoch) at the time of minting. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// VerificationJob
// ---------------------------------------------------------------------------

/** Lifecycle status of a verification job submitted to the Oracle contract. */
export type VerificationJobStatus = "pending" | "processing" | "verified" | "rejected" | "failed";

/**
 * Tracks a single verification job from submission through to certificate
 * issuance (or failure).
 */
export interface VerificationJob {
  /** Unique job identifier returned by the Oracle `submit_request` call. */
  jobId: string;
  /** Current lifecycle status of the job. */
  status: VerificationJobStatus;
  /** SHA-256 hex digest of the media content being verified. */
  contentHash: string;
  /** SHA-256 hex digest of the attached manifest JSON. */
  manifestHash: string;
  /** On-chain certificate ID, populated once the job reaches `verified` status. */
  certificateId?: string;
}

// ---------------------------------------------------------------------------
// ApiResponse — generic wrapper for all API / service responses
// ---------------------------------------------------------------------------

/**
 * Generic wrapper returned by service functions and API routes.
 *
 * On success: `{ success: true, data: T }`
 * On failure: `{ success: false, error: string }`
 */
export type ApiResponse<T> =
  { success: true; data: T; error?: never } | { success: false; error: string; data?: never };

// ---------------------------------------------------------------------------
// SLA tracking  (mirrors oracle ProviderSLA + SLACompliance structs)
// ---------------------------------------------------------------------------

/** SLA targets and rolling actuals for a provider. */
export interface ProviderSLA {
  // Targets
  targetResponseTimeSeconds: number;
  targetUptimePercentage: number;
  targetSuccessRate: number;
  // Actuals
  actualResponseTime: number;
  actualUptime: number;
  actualSuccessRate: number;
  // Internal counters
  totalRequests: number;
  successful: number;
  totalResponseSum: number;
}

/** Per-metric compliance result, including the overall compliance percentage. */
export interface SLACompliance {
  responseTimeOk: boolean;
  uptimeOk: boolean;
  successRateOk: boolean;
  /** Fraction of met targets expressed as a value in [0, 100]. */
  compliancePercent: number;
  suspended: boolean;
}

// ---------------------------------------------------------------------------
// Cost estimation  (mirrors oracle CostEstimate + ProviderPricing structs)
// ---------------------------------------------------------------------------

export type PriorityLevel = "low" | "normal" | "high" | "urgent";
export type ContentComplexity = "simple" | "moderate" | "complex";

/** Pricing configuration for a provider (amounts in stroops). */
export interface ProviderPricing {
  baseFeeStroops: number;
  perKbFeeStroops: number;
}

/** Itemised cost breakdown returned by the oracle estimate_cost function. */
export interface CostEstimate {
  baseFee: number;
  sizeFee: number;
  priorityFee: number;
  complexityFee: number;
  total: number;
}

// ---------------------------------------------------------------------------
// TEE hash certificate references  (mirrors registry TeeHashCertRef struct)
// ---------------------------------------------------------------------------

/** Attestation certificate metadata attached to an approved TEE code hash. */
export interface TeeHashCertRef {
  /** Human-readable identifier or fingerprint for the certificate issuer. */
  issuer: string;
  /** Unix timestamp from which the certificate is valid (seconds). */
  validFrom: number;
  /** Unix timestamp at which the certificate expires (seconds). */
  validUntil: number;
  /** Optional URI pointing to the full DER/PEM certificate (e.g. IPFS). */
  certUri?: string;
  /** The TEE code hash covered by this certificate (hex string). */
  codeHash: string;
}

/** Result of querying a TEE hash together with its certificate reference. */
export interface TeeHashWithCert {
  approved: boolean;
  certRef?: TeeHashCertRef;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/**
 * Narrows an `ApiResponse<T>` to the success branch.
 * Use this instead of checking `response.success === true` manually.
 */
export function isApiSuccess<T>(
  response: ApiResponse<T>,
): response is { success: true; data: T; error?: never } {
  return response.success === true;
}

/**
 * Narrows an `ApiResponse<T>` to the failure branch.
 */
export function isApiError<T>(
  response: ApiResponse<T>,
): response is { success: false; error: string; data?: never } {
  return response.success === false;
}

/**
 * Returns true if `status` is a valid `VerificationStatus` string.
 */
export function isVerificationStatus(status: string): status is VerificationStatus {
  return (
    status === "pending" ||
    status === "processing" ||
    status === "certified" ||
    status === "failed"
  );
}

/**
 * Returns true if `status` is a valid `VerificationJobStatus` string.
 */
export function isVerificationJobStatus(status: string): status is VerificationJobStatus {
  return (
    status === "pending" ||
    status === "processing" ||
    status === "verified" ||
    status === "rejected" ||
    status === "failed"
  );
}

/**
 * Type guard for `CertificateDetails`. Validates that the required fields are
 * present and correctly typed so callers don't need to cast from `unknown`.
 */
export function isCertificateDetails(value: unknown): value is CertificateDetails {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.storageRef === "string" &&
    typeof v.manifestHash === "string" &&
    typeof v.attestationHash === "string" &&
    typeof v.creator === "string" &&
    typeof v.timestamp === "number"
  );
}

/**
 * Type guard for `ContentManifest`.
 */
export function isContentManifest(value: unknown): value is ContentManifest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contentHash === "string" &&
    typeof v.creator === "string" &&
    typeof v.timestamp === "string"
  );
}

// ---------------------------------------------------------------------------
// Generic utility types
// ---------------------------------------------------------------------------

/** Makes every property of T deeply readonly. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Extracts the data type from a successful ApiResponse. */
export type ApiData<R extends ApiResponse<unknown>> = R extends { success: true; data: infer D }
  ? D
  : never;

/** Makes the listed keys required while keeping the rest as-is. */
export type RequireFields<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

// ---------------------------------------------------------------------------
// Collaborative Verification (Issue #468)
// ---------------------------------------------------------------------------

/** User role in a verification team. */
export type TeamRole = "owner" | "editor" | "reviewer" | "viewer";

/** Permission levels for collaborative features. */
export type Permission =
  | "view_verification"
  | "edit_verification"
  | "approve_verification"
  | "manage_team"
  | "export_data";

/** Member of a verification team. */
export interface TeamMember {
  publicKey: string;
  role: TeamRole;
  addedAt: number;
  permissions: Permission[];
}

/** Verification team for collaborative work. */
export interface VerificationTeam {
  id: string;
  name: string;
  description?: string;
  owner: string;
  members: TeamMember[];
  createdAt: number;
  updatedAt: number;
}

/** Shared verification document with edit tracking. */
export interface SharedVerificationDocument {
  id: string;
  teamId: string;
  certificateId?: string;
  title: string;
  description?: string;
  contentHash: string;
  manifestHash: string;
  status: "draft" | "in_review" | "approved" | "rejected";
  createdBy: string;
  createdAt: number;
  lastModifiedBy: string;
  lastModifiedAt: number;
  editors: string[];
}

/** Workflow step for verification authorization. */
export interface WorkflowStep {
  id: string;
  documentId: string;
  stepNumber: number;
  approverRole: TeamRole;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: number;
  comment?: string;
}

/** Audit log entry tracking user actions. */
export interface AuditLogEntry {
  id: string;
  entityType: "team" | "document" | "workflow" | "verification";
  entityId: string;
  action: string;
  actor: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

/** Notification for team members about verification activities. */
export interface VerificationNotification {
  id: string;
  recipientPublicKey: string;
  type: "team_invite" | "document_shared" | "approval_requested" | "verification_complete";
  relatedEntityId: string;
  message: string;
  read: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Content Versioning (Issue #469)
// ---------------------------------------------------------------------------

/** A version of verified content. */
export interface ContentVersion {
  id: string;
  certificateId?: string;
  versionNumber: number;
  contentHash: string;
  manifestHash: string;
  creator: string;
  createdAt: number;
  changeLog?: string;
  previousVersionId?: string;
  nextVersionId?: string;
  isCurrentVersion: boolean;
}

/** Version history for a piece of content. */
export interface VersionHistory {
  id: string;
  contentHash: string;
  contentTitle?: string;
  versions: ContentVersion[];
  totalVersions: number;
  createdAt: number;
  updatedAt: number;
}

/** Comparison between two versions. */
export interface VersionComparison {
  versionA: ContentVersion;
  versionB: ContentVersion;
  differences: VersionDifference[];
}

/** Detailed difference between two versions. */
export interface VersionDifference {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: "added" | "removed" | "modified";
}

// ---------------------------------------------------------------------------
// Analytics Dashboard (Issue #470)
// ---------------------------------------------------------------------------

/** Verification statistics. */
export interface VerificationStatistics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  successRate: number;
  averageProcessingTime: number;
}

/** Usage trend data point. */
export interface UsageTrendData {
  date: string;
  verifications: number;
  uniqueUsers: number;
  successfulCertificates: number;
}

/** Usage trends over a time period. */
export interface UsageTrends {
  period: "day" | "week" | "month" | "year";
  data: UsageTrendData[];
}

/** Content type popularity metrics. */
export interface ContentTypeMetric {
  contentType: string;
  count: number;
  percentage: number;
}

/** Content popularity data. */
export interface PopularContentData {
  contentTypes: ContentTypeMetric[];
  topContentHashes: Array<{
    contentHash: string;
    verificationCount: number;
    lastVerifiedAt: number;
  }>;
}

/** Geographic distribution data. */
export interface GeographicDistribution {
  country: string;
  region?: string;
  userCount: number;
  verificationCount: number;
  latitude?: number;
  longitude?: number;
}

/** User analytics data. */
export interface UserAnalytics {
  totalUsers: number;
  activeUsers: number;
  newUsersThisMonth: number;
  verificationsByUser: Array<{
    publicKey: string;
    verificationCount: number;
    successfulVerifications: number;
  }>;
}

/** Report export data. */
export interface AnalyticsReport {
  id: string;
  generatedAt: number;
  generatedBy: string;
  period: string;
  statistics: VerificationStatistics;
  trends: UsageTrends;
  contentPopularity: PopularContentData;
  geographicDistribution: GeographicDistribution[];
  userAnalytics: UserAnalytics;
  format: "pdf" | "csv" | "json";
}
