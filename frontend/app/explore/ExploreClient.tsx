"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { computeConfidence } from "@stellarveriphy/shared/scoring";
import type { VerificationRecord } from "@stellarveriphy/shared/types";
import ConfidenceScore from "@/components/ConfidenceScore";
import StatusBadge from "@/components/StatusBadge";
import {
  AssetStatusFilterChips,
  matchesAssetStatusFilter,
  type AssetStatusFilter,
} from "@/components/AssetStatusFilterChips";

interface ExploreClientProps {
  initialRecords: VerificationRecord[];
}

export function ExploreClient({ initialRecords }: ExploreClientProps) {
  const [selectedStatus, setSelectedStatus] = useState<AssetStatusFilter>("all");

  const counts = useMemo(() => {
    const map: Partial<Record<AssetStatusFilter, number>> = {
      all: initialRecords.length,
      verified: 0,
      pending: 0,
      unverified: 0,
      disputed: 0,
      archived: 0,
    };

    for (const record of initialRecords) {
      if (matchesAssetStatusFilter(record.status, "verified")) map.verified = (map.verified ?? 0) + 1;
      if (matchesAssetStatusFilter(record.status, "pending")) map.pending = (map.pending ?? 0) + 1;
      if (matchesAssetStatusFilter(record.status, "unverified")) map.unverified = (map.unverified ?? 0) + 1;
      if (matchesAssetStatusFilter(record.status, "disputed")) map.disputed = (map.disputed ?? 0) + 1;
      if (matchesAssetStatusFilter(record.status, "archived")) map.archived = (map.archived ?? 0) + 1;
    }

    return map;
  }, [initialRecords]);

  const filteredRecords = useMemo(() => {
    return initialRecords.filter((record) =>
      matchesAssetStatusFilter(record.status, selectedStatus)
    );
  }, [initialRecords, selectedStatus]);

  return (
    <div className="mt-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-gray-800 pb-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">
            Filter by Asset Status
          </h2>
          <AssetStatusFilterChips
            selectedStatus={selectedStatus}
            onSelectStatus={setSelectedStatus}
            counts={counts}
            className="mt-2"
          />
        </div>
        <div className="text-xs text-slate-500 dark:text-gray-400">
          Showing {filteredRecords.length} of {initialRecords.length} assets
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-gray-800 p-12 text-center text-slate-500">
          <p className="text-base font-medium">No assets found</p>
          <p className="mt-1 text-sm">There are no assets with status &ldquo;{selectedStatus}&rdquo;.</p>
          <button
            type="button"
            onClick={() => setSelectedStatus("all")}
            className="mt-4 inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          >
            Show all assets
          </button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRecords.map((record) => (
            <li
              key={record.id}
              className="relative flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm focus-within:ring-2 focus-within:ring-indigo-600 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-500">
                <span>{record.mediaType}</span>
                <StatusBadge status={record.status} />
              </div>
              <h2 className="mt-3 font-semibold">
                <Link
                  href={`/certificates/${record.id}`}
                  className="hover:underline focus:outline-none dark:text-white"
                >
                  {record.title}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {new Date(record.manifest.timestamp).toLocaleDateString("en", {
                  dateStyle: "medium",
                })}
              </p>
              <div className="mt-4">
                <ConfidenceScore result={computeConfidence(record)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export default ExploreClient;
