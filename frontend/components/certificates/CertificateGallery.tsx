"use client";

/**
 * CertificateGallery.tsx
 *
 * Grid gallery for browsing certificates (Issue #461).
 *
 * Features:
 * - Responsive grid layout with deterministic gradient thumbnails
 * - Lightbox modal on click showing full certificate details
 * - Filter by creator, sort by newest/oldest
 * - Infinite scroll (via {@link useInfiniteScroll}) that pages through
 *   {@link searchCertificates}
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { type CertificateDetails, searchCertificates } from "@/services/certificateVerificationService";

const PAGE_SIZE = 9;

type SortOrder = "newest" | "oldest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic hue from a certificate id/hash so thumbnails don't flicker on re-render. */
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CertificateGalleryProps {
  className?: string;
}

export function CertificateGallery({ className = "" }: CertificateGalleryProps) {
  const [items, setItems] = useState<CertificateDetails[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creatorFilter, setCreatorFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [selected, setSelected] = useState<CertificateDetails | null>(null);

  const loadPage = useCallback(async (nextOffset: number) => {
    setLoading(true);
    try {
      const res = await searchCertificates({
        creator: creatorFilter || undefined,
        offset: nextOffset,
        limit: PAGE_SIZE,
      });
      if (res.success && res.data) {
        setItems((prev) => (nextOffset === 0 ? res.data!.certificates : [...prev, ...res.data!.certificates]));
        setTotal(res.data.total);
        setOffset(nextOffset + res.data.certificates.length);
      }
    } finally {
      setLoading(false);
    }
  }, [creatorFilter]);

  // Reload from scratch whenever the filter changes.
  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const { sentinelRef, isIntersecting, reset } = useInfiniteScroll({
    enabled: !loading && items.length < total,
  });

  useEffect(() => {
    if (isIntersecting && !loading && items.length < total) {
      loadPage(offset).then(reset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIntersecting]);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => (sortOrder === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp));
    return copy;
  }, [items, sortOrder]);

  return (
    <div className={className}>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={creatorFilter}
          onChange={(e) => setCreatorFilter(e.target.value)}
          placeholder="Filter by creator address…"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((cert) => {
          const hue = hueFromId(cert.id);
          return (
            <button
              key={cert.id}
              onClick={() => setSelected(cert)}
              className="group overflow-hidden rounded-lg border border-gray-200 text-left transition hover:shadow-md dark:border-gray-800"
              aria-label={`View certificate ${cert.id}`}
            >
              <div
                className="flex aspect-square items-center justify-center text-3xl font-bold text-white/90"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 60) % 360} 70% 55%))`,
                }}
              >
                #{cert.id}
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                  {cert.creator.slice(0, 8)}…{cert.creator.slice(-4)}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(cert.timestamp)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {items.length === 0 && !loading && (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No certificates found.</p>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-8" />
      {loading && (
        <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      )}

      {/* Lightbox */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Certificate #{selected.id}
              </h3>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Creator</dt>
                <dd className="break-all font-mono text-gray-800 dark:text-gray-200">{selected.creator}</dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Storage reference</dt>
                <dd className="break-all font-mono text-gray-800 dark:text-gray-200">{selected.storageRef}</dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Manifest hash</dt>
                <dd className="break-all font-mono text-xs text-gray-800 dark:text-gray-200">
                  {selected.manifestHash}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Created</dt>
                <dd className="text-gray-800 dark:text-gray-200">{formatDate(selected.timestamp)}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

export default CertificateGallery;
