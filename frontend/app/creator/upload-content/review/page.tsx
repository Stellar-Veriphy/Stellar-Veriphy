"use client";

import { useRouter } from "next/navigation";

import { useWizard } from "@/context/WizardContext";

function downloadManifest(manifest: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReviewPage() {
  const router = useRouter();
  const {
    mode,
    file,
    contentHash,
    advancedContentHash,
    advancedManifestHash,
    manifest,
    manifestHash,
  } = useWizard();

  const handleDownloadManifest = () => {
    if (manifest) {
      const filename = `asset-manifest-${new Date().toISOString().slice(0, 10)}.json`;
      downloadManifest(manifest, filename);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Review Verification</h2>
        {manifest && (
          <button
            onClick={handleDownloadManifest}
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            title="Download manifest as JSON"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Manifest
          </button>
        )}
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-sm text-gray-600">Mode</p>
        <p className="font-semibold capitalize">{mode}</p>
      </div>

      {mode === "standard" && file && (
        <>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">File</p>
            <p className="font-semibold">{file.name}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Content Hash</p>
            <p className="font-mono text-sm break-all">{contentHash}</p>
          </div>
        </>
      )}

      {mode === "advanced" && (
        <>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Content Hash</p>
            <p className="font-mono text-sm break-all">{advancedContentHash}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Manifest Hash</p>
            <p className="font-mono text-sm break-all">{advancedManifestHash}</p>
          </div>
        </>
      )}

      {manifest && (
        <div className="bg-gray-50 p-4 rounded-lg max-h-64 overflow-auto">
          <p className="text-sm text-gray-600 mb-2">Manifest</p>
          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </div>
      )}

      {manifestHash && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Manifest Hash</p>
          <p className="font-mono text-sm break-all">{manifestHash}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => router.back()}
        className="text-sm font-medium text-gray-600 hover:text-gray-900 transition"
      >
        ← Back
      </button>
      <button className="w-full bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition">
        Submit for Verification
      </button>
    </div>
  );
}
