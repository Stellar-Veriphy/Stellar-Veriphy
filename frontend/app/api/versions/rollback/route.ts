import type { ApiResponse, ContentVersion } from "@stellarveriphy/shared";
import { NextRequest, NextResponse } from "next/server";

function getStoredVersions(): ContentVersion[] {
  if (typeof globalThis !== "undefined" && "versions" in globalThis) {
    return (globalThis as unknown as Record<string, unknown>).versions as ContentVersion[];
  }
  return [];
}

function setStoredVersions(versions: ContentVersion[]) {
  if (typeof globalThis !== "undefined") {
    (globalThis as unknown as Record<string, ContentVersion[]>).versions = versions;
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<ContentVersion>>> {
  try {
    const body = await request.json() as { contentHash: string; versionId: string };
    const versions = getStoredVersions();

    const targetVersion = versions.find((v) => v.id === body.versionId);
    if (!targetVersion) {
      return NextResponse.json({ success: false, error: "Version not found" }, { status: 404 });
    }

    const currentVersion = versions.find(
      (v) => v.contentHash === body.contentHash && v.isCurrentVersion,
    );
    if (currentVersion) {
      currentVersion.isCurrentVersion = false;
    }

    const newRolledBackVersion: ContentVersion = {
      id: `version_${Date.now()}`,
      versionNumber: Math.max(...versions.map((v) => v.versionNumber)) + 1,
      contentHash: body.contentHash,
      manifestHash: targetVersion.manifestHash,
      creator: "user_placeholder",
      createdAt: Date.now(),
      changeLog: `Rolled back to version ${targetVersion.versionNumber}`,
      previousVersionId: currentVersion?.id,
      isCurrentVersion: true,
    };

    versions.push(newRolledBackVersion);
    setStoredVersions(versions);

    return NextResponse.json({ success: true, data: newRolledBackVersion });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to rollback version" },
      { status: 500 },
    );
  }
}
