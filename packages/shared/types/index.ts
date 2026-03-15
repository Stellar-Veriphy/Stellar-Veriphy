export interface ContentManifest {
  contentHash: string;       // sha256 of the media file
  creator: string;           // Stellar public key (G...)
  timestamp: string;         // ISO 8601
  metadata?: {
    device?: string;
    location?: string;
    aiModel?: string;
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
