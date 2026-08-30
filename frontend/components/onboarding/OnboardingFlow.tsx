"use client";

import { CheckCircle2, FileCheck2, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useOnboarding } from "@/hooks/useOnboarding";
import { cn } from "@/utils/cn";

interface OnboardingScreen {
  icon: React.ComponentType<{ className?: string | undefined }>;
  title: string;
  description: string;
}

const SCREENS: OnboardingScreen[] = [
  {
    icon: Sparkles,
    title: "Welcome to StellarVeriphy",
    description:
      "Your decentralized platform for verifying content authenticity and provenance on the Stellar blockchain.",
  },
  {
    icon: ShieldCheck,
    title: "Verify Content Authenticity",
    description:
      "Cryptographically verify that media hasn't been tampered with, using content hashing and signature checks in seconds.",
  },
  {
    icon: FileCheck2,
    title: "Blockchain-Backed Provenance",
    description:
      "Every verification is anchored to the Stellar ledger, giving you a tamper-proof, publicly auditable trail of origin.",
  },
  {
    icon: KeyRound,
    title: "Batch Verification & API Access",
    description:
      "Verify content at scale with batch uploads, or integrate directly into your workflow using API keys.",
  },
  {
    icon: CheckCircle2,
    title: "You're All Set",
    description:
      "Jump in and start verifying your first piece of content — you can revisit this tour anytime from Help.",
  },
];

/**
 * First-time onboarding flow: a welcome screen followed by feature
 * highlight screens, with skip/progress controls and a persistent
 * "don't show again" dismissal.
 */
export function OnboardingFlow() {
  const { isOpen, close } = useOnboarding();
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setDontShowAgain(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close(dontShowAgain);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, close, dontShowAgain]);

  if (!isOpen) return null;

  const total = SCREENS.length;
  const isLast = step === total - 1;
  const screen = SCREENS[step];
  if (!screen) return null;
  const Icon = screen.icon;

  const handleNext = () => {
    if (isLast) {
      close(dontShowAgain);
    } else {
      setStep((s) => Math.min(s + 1, total - 1));
    }
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 0));
  const handleSkip = () => close(dontShowAgain);

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleSkip();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md sm:max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl",
          "border border-gray-200 dark:border-gray-800",
          "animate-in fade-in zoom-in-95 duration-200 focus:outline-none",
          "flex flex-col max-h-[90vh]"
        )}
      >
        {/* Skip */}
        <button
          onClick={handleSkip}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]"
        >
          Skip
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pt-10 pb-4 sm:px-8 sm:pt-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-5 sm:mb-6">
            <Icon className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
          </div>
          <h2
            id="onboarding-title"
            className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2"
          >
            {screen.title}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm">{screen.description}</p>
        </div>

        {/* Progress dots */}
        <div
          className="flex items-center justify-center gap-1.5 py-2"
          role="tablist"
          aria-label="Onboarding progress"
        >
          {SCREENS.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === step}
              aria-label={`Go to step ${i + 1} of ${total}`}
              onClick={() => setStep(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step
                  ? "w-6 bg-blue-500"
                  : "w-1.5 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500"
              )}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 pb-6 pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-4">
          {isLast && (
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              Don&apos;t show this again
            </label>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleBack}
              disabled={step === 0}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg min-h-[44px] transition-colors",
                step === 0
                  ? "opacity-0 pointer-events-none"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              )}
            >
              Back
            </button>
            <span className="text-xs text-gray-400" aria-hidden="true">
              {step + 1} / {total}
            </span>
            <button
              onClick={handleNext}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg min-h-[44px] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {isLast ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
