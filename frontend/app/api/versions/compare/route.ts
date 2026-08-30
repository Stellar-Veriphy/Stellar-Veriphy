import type { ApiResponse, VersionComparison, ContentVersion } from "@stellarveriphy/shared";
import { NextRequest, NextResponse } from "next/server";

function getStoredVersions(): ContentVersion[] {
  if (typeof globalThis !== "undefined" && "versions" in globalThis) {
    return (globalThis as unknown as Record<string, unknown>).versions as ContentVersion[];
  }
  return [];
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<ApiResponse<VersionComparison>>> {
  try {
    const { searchParams } = new URL(request.url);
    const versionAId = searchParams.get("versionA");
    const versionBId = searchParams.get("versionB");

    if (!versionAId || !versionBId) {
      return NextResponse.json(
        { success: false, error: "Both versionA and versionB are required" },
        { status: 400 },
      );
    }

    const versions = getStoredVersions();
    const versionA = versions.find((v) => v.id === versionAId);
    const versionB = versions.find((v) => v.id === versionBId);

    if (!versionA || !versionB) {
      return NextResponse.json(
        { success: false, error: "One or both versions not found" },
        { status: 404 },
      );
    }

    const comparison: VersionComparison = {
      versionA,
      versionB,
      differences: [
        {
          field: "manifestHash",
          oldValue: versionA.manifestHash,
          newValue: versionB.manifestHash,
          changeType: versionA.manifestHash === versionB.manifestHash ? "modified" : "modified",
        },
        {
          field: "versionNumber",
          oldValue: versionA.versionNumber,
          newValue: versionB.versionNumber,
          changeType: "modified",
        },
      ],
    };

    return NextResponse.json({ success: true, data: comparison });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to compare versions" },
      { status: 500 },
    );
  }
}
