import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { UploadForm } from "./upload-form";
import { DeleteButton } from "./delete-button";

// Multi-PDF uploads to Blob can exceed the default 10s; give the full budget.
export const maxDuration = 60;

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireWorkspaceAccess(id);
  if (!canManageWorkspace(membership?.role, user.role)) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600">
        Only deal-team members can upload files.
      </div>
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: { documents: { orderBy: { createdAt: "desc" } } }
  });
  if (!workspace) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/deals/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Back to {workspace.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Upload files</h1>
        <p className="mt-1 text-sm text-slate-600">
          Drop files in, click to pick, or use <em>Choose folder</em> to ingest an entire OneDrive-
          synced data-room folder in one shot. Files are stored privately to this deal workspace
          and read by Claude when IC members ask questions.
        </p>
      </div>

      <UploadForm workspaceId={id} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          All documents ({workspace.documents.length})
        </h2>
        {workspace.documents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            No documents yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {workspace.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-900">{d.filename}</div>
                  <div className="text-xs text-slate-500">
                    {d.mimeType} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.createdAt)}
                    {d.statusReason ? ` · ${d.statusReason}` : ""}
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      d.status === "ready"
                        ? "bg-emerald-100 text-emerald-800"
                        : d.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {d.status}
                  </span>
                  <DeleteButton workspaceId={id} documentId={d.id} filename={d.filename} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
