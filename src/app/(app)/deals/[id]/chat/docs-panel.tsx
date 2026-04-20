import Link from "next/link";
import { formatBytes } from "@/lib/utils";
import { humanLabel } from "@/lib/extraction";

type Doc = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  storageKey: string;
  createdAt: Date;
};

export function DocsPanel({
  workspaceId,
  canManage,
  documents
}: {
  workspaceId: string;
  canManage: boolean;
  documents: Doc[];
}) {
  const ready = documents.filter((d) => d.status === "ready").length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Documents
          </div>
          <div className="text-xs text-slate-600">
            {ready} ready · {documents.length} total
          </div>
        </div>
        {canManage ? (
          <Link
            href={`/deals/${workspaceId}/upload`}
            className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
          >
            Upload
          </Link>
        ) : null}
      </div>

      {documents.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-500">
          No documents uploaded yet.
        </div>
      ) : (
        <ul className="max-h-[calc(100vh-14rem)] divide-y divide-slate-100 overflow-y-auto text-sm">
          {documents.map((d) => (
            <li key={d.id} className="px-3 py-2">
              <a
                href={d.storageKey}
                target="_blank"
                rel="noreferrer noopener"
                className="block"
                title={`Open ${d.filename}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {d.filename}
                    </div>
                    <div className="text-xs text-slate-500">
                      {humanLabel(d.mimeType)} · {formatBytes(d.sizeBytes)}
                    </div>
                  </div>
                  <StatusBadge status={d.status} />
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "ready"
      ? "bg-emerald-100 text-emerald-800"
      : status === "failed"
        ? "bg-red-100 text-red-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {status}
    </span>
  );
}
