"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProvenanceHistoryView } from "@/components/provenance";
import { getCertificateHistory, loadProvenanceDataset, type ProvenanceDataset } from "@/lib/provenance/data";

export default function ProvenanceHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProvenanceDataset | null>(null);

  useEffect(() => {
    loadProvenanceDataset().then(setData);
  }, []);

  const record = data?.records.find((r) => r.id === id);

  return (
    <main id="main-content" className="min-h-screen bg-gray-50 py-8 dark:bg-gray-900">
      {!data ? (
        <p className="text-center text-sm text-gray-500">Loading provenance…</p>
      ) : !record ? (
        <p className="text-center text-sm text-gray-600 dark:text-gray-300">Certificate #{id} was not found.</p>
      ) : (
        <ProvenanceHistoryView record={record} events={getCertificateHistory(data, record.id)} />
      )}
    </main>
  );
}
