import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { formatBytes, formatDateTime } from "@/lib/utils";

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
    include: {
      documents: { orderBy: { createdAt: "desc" } }
    }
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
          PDF, Excel, PowerPoint, Word, and plain text. Scanned PDFs are OCR&apos;d automatically.
        </p>
      </div>

      {/* Week 2: replace with dropzone + server action that writes to storage provider */}
      <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-slate-700">Drag and drop files here</p>
        <p className="mt-1 text-xs text-slate-500">
          Upload handler lands in week 2 (storage provider + ingestion pipeline).
        </p>
        <button
          type="button"
          disabled
          className="mt-4 rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
        >
          Choose files (coming soon)
        </button>
      </div>

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
                <div>
                  <div className="font-medium text-slate-900">{d.filename}</div>
                  <div className="text-xs text-slate-500">
                    {d.mimeType} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.createdAt)}
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
