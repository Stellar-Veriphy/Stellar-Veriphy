"use client";

import { useMemo, useState } from "react";
import type { ProvenanceExportFormat, ProvenanceRecord } from "@stellarveriphy/shared/types";
import {
  PROVENANCE_EXPORT_SCHEMA_VERSION,
  buildExportFileName,
  chunkRecords,
  exportMimeType,
  serializeRecords,
  validateRecords,
} from "@stellarveriphy/shared/utils/provenanceExport";
import { useWallet } from "@/context/WalletContext";
import { resolveExportRole } from "@/lib/provenance/access";

interface BulkExportPanelProps {
  records: ProvenanceRecord[];
}

function download(content: string, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkExportPanel({ records }: BulkExportPanelProps) {
  const { publicKey } = useWallet();
  const role = resolveExportRole(publicKey);
  const [format, setFormat] = useState<ProvenanceExportFormat>("csv");
  const [status, setStatus] = useState<"all" | ProvenanceRecord["status"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const scope = role === "admin" ? "all" : "own";
  const selected = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() / 1000 : -Infinity;
    const toTs = to ? new Date(to).getTime() / 1000 + 86_399 : Infinity;
    return records
      .filter((r) => scope === "all" || r.creator === publicKey)
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => r.timestamp >= fromTs && r.timestamp <= toTs)
      .sort((a, b) => Number(a.id) - Number(b.id));
  }, [records, scope, publicKey, status, from, to]);

  if (role === "guest") {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
        Connect a wallet to export provenance records. Creators can export the records they own; administrators can export every record.
      </div>
    );
  }

  const handleExport = async () => {
    setBusy(true);
    setMessage(null);
    const errors = validateRecords(selected);
    if (errors.length) {
      setMessage({ kind: "error", text: `Validation failed: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ""}` });
      setBusy(false);
      return;
    }
    const now = new Date();
    const chunks = chunkRecords(selected);
    for (let i = 0; i < chunks.length; i++) {
      const meta = {
        schemaVersion: PROVENANCE_EXPORT_SCHEMA_VERSION,
        exportedAt: now.toISOString(),
        exportedBy: publicKey!,
        scope,
        recordCount: chunks[i].length,
        part: i + 1,
        totalParts: chunks.length,
      } as const;
      download(
        serializeRecords(chunks[i], format, meta),
        buildExportFileName(format, scope, now, i + 1, chunks.length),
        exportMimeType(format),
      );
      // yield so the browser can process each download
      await new Promise((r) => setTimeout(r, 150));
    }
    setMessage({ kind: "ok", text: `Exported ${selected.length.toLocaleString()} records in ${chunks.length} file(s).` });
    setBusy(false);
  };

  const inputCls =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Role: <span className="font-semibold capitalize">{role}</span> — exporting{" "}
        {scope === "all" ? "all platform records" : "records owned by your wallet"}.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as ProvenanceExportFormat)} className={inputCls}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="ndjson">NDJSON (streaming)</option>
          </select>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
            <option value="expired">Expired</option>
          </select>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Minted from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Minted to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={handleExport}
          disabled={busy || selected.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Exporting…" : `Export ${selected.length.toLocaleString()} records`}
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400 break-all">
          {buildExportFileName(format, scope, new Date())}
        </span>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
