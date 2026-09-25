"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MetricsCards, RecentActivityTimeline } from "@/components/dashboard";
import {
  computeMetrics,
  loadProvenanceDataset,
  type DashboardMetrics,
  type ProvenanceDataset,
} from "@/lib/provenance/data";

export default function DashboardPage() {
  const [data, setData] = useState<ProvenanceDataset | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    loadProvenanceDataset().then((d) => {
      setData(d);
      setMetrics(computeMetrics(d));
    });
  }, []);

  return (
    <main id="main-content" className="min-h-screen bg-gray-50 py-8 dark:bg-gray-900">
      <div className="mx-auto max-w-6xl space-y-6 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
          <Link href="/provenance/export" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
            Bulk export records →
          </Link>
        </div>
        <MetricsCards metrics={metrics} />
        {data && <RecentActivityTimeline events={data.events} />}
      </div>
    </main>
  );
}
