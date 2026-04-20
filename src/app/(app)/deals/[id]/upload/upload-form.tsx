"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

const ACCEPT = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
].join(",");

const EXT_WHITELIST = /\.(pdf|docx|pptx|xlsx)$/i;
const MAX_BYTES = 32 * 1024 * 1024;
const CONCURRENCY = 4;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isSystemFile(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.toLowerCase() === "thumbs.db" ||
    name.toLowerCase() === "desktop.ini" ||
    /~\$/.test(name) // Word/Excel/PPT temp lock files
  );
}

type Row = {
  file: File;
  relPath: string;
  status: "queued" | "uploading" | "done" | "error" | "skipped";
  error?: string;
};

function collectFiles(list: FileList | File[]): Row[] {
  const out: Row[] = [];
  for (const f of Array.from(list)) {
    // webkitRelativePath is populated when the user picks a folder.
    const relPath =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const baseName = relPath.split("/").pop() ?? f.name;
    if (isSystemFile(baseName)) {
      out.push({ file: f, relPath, status: "skipped", error: "system file" });
      continue;
    }
    if (!EXT_WHITELIST.test(baseName)) {
      out.push({ file: f, relPath, status: "skipped", error: "unsupported type" });
      continue;
    }
    if (f.size > MAX_BYTES) {
      out.push({ file: f, relPath, status: "skipped", error: "over 32 MB" });
      continue;
    }
    out.push({ file: f, relPath, status: "queued" });
  }
  return out;
}

export function UploadForm({ workspaceId }: { workspaceId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function addFiles(list: FileList | File[]) {
    setError(null);
    setRows((prev) => [...prev, ...collectFiles(list)]);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const uploadable = rows.filter((r) => r.status === "queued" || r.status === "error");
    if (uploadable.length === 0) {
      setError("Pick at least one supported file.");
      return;
    }
    setError(null);

    startTransition(async () => {
      // Simple concurrency-limited runner. Kick off CONCURRENCY workers, each
      // pulling indices until the queue is empty.
      const indices = rows.map((_, i) => i).filter((i) => {
        const s = rows[i].status;
        return s === "queued" || s === "error";
      });
      let cursor = 0;

      async function worker() {
        while (true) {
          const myIndex = cursor++;
          if (myIndex >= indices.length) return;
          const rowIndex = indices[myIndex];
          const row = rows[rowIndex];
          setRows((prev) => {
            const next = [...prev];
            next[rowIndex] = { ...next[rowIndex], status: "uploading", error: undefined };
            return next;
          });
          try {
            const pathname = `workspaces/${workspaceId}/${crypto.randomUUID()}-${safeName(
              row.file.name
            )}`;
            await upload(pathname, row.file, {
              access: "public",
              handleUploadUrl: "/api/upload/handle",
              contentType: row.file.type,
              clientPayload: JSON.stringify({
                workspaceId,
                filename: row.file.name,
                sizeBytes: row.file.size
              })
            });
            setRows((prev) => {
              const next = [...prev];
              next[rowIndex] = { ...next[rowIndex], status: "done" };
              return next;
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "upload failed";
            setRows((prev) => {
              const next = [...prev];
              next[rowIndex] = { ...next[rowIndex], status: "error", error: msg };
              return next;
            });
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      router.refresh();
    });
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const files: File[] = [];
    if (e.dataTransfer.items) {
      // items may include directories via DataTransferItem — fall back to files
      // for cross-browser sanity. Users who want full folder support use the
      // "Choose folder" button (webkitdirectory input).
      for (const item of Array.from(e.dataTransfer.items)) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    } else {
      files.push(...Array.from(e.dataTransfer.files));
    }
    if (files.length > 0) addFiles(files);
  }

  const queuedCount = rows.filter((r) => r.status === "queued").length;
  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label
        htmlFor="file-input"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-slate-500 bg-slate-50"
            : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50"
        }`}
      >
        <div className="text-sm font-medium text-slate-700">
          {rows.length === 0
            ? "Drop files here, click to choose files, or use the folder button below"
            : `${rows.length} file${rows.length === 1 ? "" : "s"} selected`}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx). Max 32&nbsp;MB per file.
        </div>
        <input
          id="file-input"
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
          disabled={isPending}
          className="hidden"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Choose folder (OneDrive data room)
        </button>
        <input
          ref={folderInputRef}
          type="file"
          // webkitdirectory lets users pick a folder; browser recurses and
          // populates files. Attribute has spread beyond webkit despite the
          // name — Chrome, Edge, Firefox, Safari all honor it.
          // @ts-expect-error: not in React's HTMLInputElement types but valid HTML
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
          disabled={isPending}
        />
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => setRows([])}
            disabled={isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Clear list
          </button>
        ) : null}
        <div className="ml-auto text-xs text-slate-500">
          {rows.length > 0
            ? `${doneCount} done · ${queuedCount} queued · ${errorCount} error · ${skippedCount} skipped`
            : ""}
        </div>
      </div>

      {rows.length > 0 ? (
        <ul className="max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm">
          {rows.map((r, i) => (
            <li
              key={`${r.relPath}-${i}`}
              className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-800">{r.relPath}</div>
                <div className="text-xs text-slate-500">
                  {(r.file.size / 1024 / 1024).toFixed(2)} MB
                  {r.error ? ` · ${r.error}` : ""}
                </div>
              </div>
              <StatusPill status={r.status} />
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={isPending || queuedCount + errorCount === 0}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {isPending
            ? "Uploading…"
            : `Upload ${queuedCount + errorCount || ""}`.trim()}
        </button>
      </div>
    </form>
  );
}

function StatusPill({ status }: { status: Row["status"] }) {
  const map: Record<Row["status"], { label: string; className: string }> = {
    queued: { label: "queued", className: "bg-slate-100 text-slate-600" },
    uploading: { label: "uploading…", className: "bg-blue-100 text-blue-800" },
    done: { label: "done", className: "bg-emerald-100 text-emerald-800" },
    error: { label: "error", className: "bg-red-100 text-red-800" },
    skipped: { label: "skipped", className: "bg-amber-100 text-amber-800" }
  };
  const s = map[status];
  return (
    <span
      className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
