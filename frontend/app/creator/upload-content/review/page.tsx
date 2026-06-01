"use client";

import { WizardProvider, useWizard } from "@/context/WizardContext";

function ReviewContent() {
  const {
    mode,
    file,
    contentHash,
    advancedContentHash,
    advancedManifestHash,
    manifest,
    manifestHash,
  } = useWizard();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Review Verification</h2>

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

      <button className="w-full bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 transition">
        Submit for Verification
      </button>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <WizardProvider>
      <main className="max-w-2xl mx-auto py-12 px-4">
        <ReviewContent />
      </main>
    </WizardProvider>
  );
}
