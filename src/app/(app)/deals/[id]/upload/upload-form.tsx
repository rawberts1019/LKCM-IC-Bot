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

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function UploadForm({ workspaceId }: { workspaceId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setStatus(null);
    const picked = Array.from(e.target.files ?? []);
    setFiles(picked);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Pick at least one file.");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
          const pathname = `workspaces/${workspaceId}/${crypto.randomUUID()}-${safeName(
            file.name
          )}`;
          await upload(pathname, file, {
            access: "public",
            handleUploadUrl: "/api/upload/handle",
            contentType: file.type,
            clientPayload: JSON.stringify({
              workspaceId,
              filename: file.name,
              sizeBytes: file.size
            })
          });
        }
        setStatus(null);
        setFiles([]);
        formRef.current?.reset();
        router.refresh();
      } catch (e) {
        setStatus(null);
        setError(e instanceof Error ? e.message : "Upload failed.");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <label
        htmlFor="file-input"
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center hover:border-slate-400 hover:bg-slate-50"
      >
        <div className="text-sm font-medium text-slate-700">
          {files.length === 0
            ? "Click to choose PDF files"
            : `${files.length} file${files.length === 1 ? "" : "s"} selected`}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx). Max 32&nbsp;MB per file.
        </div>
        <input
          id="file-input"
          type="file"
          multiple
          accept={ACCEPT}
          onChange={handlePick}
          disabled={isPending}
          className="hidden"
        />
      </label>

      {files.length > 0 ? (
        <ul className="rounded-md border border-slate-200 bg-white text-sm">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-b-0"
            >
              <span className="truncate text-slate-800">{f.name}</span>
              <span className="ml-4 shrink-0 text-xs text-slate-500">
                {(f.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {status ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {status}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={isPending || files.length === 0}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {isPending ? "Uploading…" : `Upload ${files.length || ""}`.trim()}
        </button>
      </div>
    </form>
  );
}
