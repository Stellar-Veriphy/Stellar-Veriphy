"use client";

import { WizardProvider, useWizard } from "@/context/WizardContext";
import { MediaInput, AdvancedInput } from "@/features/verification/components/steps";

function MediaInputContent() {
  const { mode } = useWizard();

  if (mode === "advanced") {
    return <AdvancedInput />;
  }

  return <MediaInput />;
}

export default function MediaInputPage() {
  return (
    <WizardProvider>
      <main className="max-w-2xl mx-auto py-12 px-4">
        <MediaInputContent />
      </main>
    </WizardProvider>
  );
}
