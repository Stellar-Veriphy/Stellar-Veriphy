"use client";

import { WizardProvider } from "@/context/WizardContext";
import { ManifestStep } from "@/features/verification/components/steps";

export default function ManifestStepPage() {
  return (
    <WizardProvider>
      <main className="max-w-2xl mx-auto py-12 px-4">
        <ManifestStep />
      </main>
    </WizardProvider>
  );
}
