"use client";

/**
 * Settings Page — Issues #460, #462
 *
 * Hosts the user preferences panel and email notification settings.
 */

import { Header } from "@/components/Header";
import { EmailNotificationSettings } from "@/components/notifications";
import { PreferencesPanel } from "@/components/preferences";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-3xl px-6">
        <Breadcrumbs />
      </div>
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage your preferences and notification settings.
          </p>
        </div>
        <PreferencesPanel />
        <EmailNotificationSettings />
      </div>
    </main>
  );
}
