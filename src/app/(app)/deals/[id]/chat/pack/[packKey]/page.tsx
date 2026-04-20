import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { getPack } from "@/lib/question-packs";
import { PackRunner } from "./pack-runner";

export const maxDuration = 60;

export default async function PackRunPage({
  params
}: {
  params: Promise<{ id: string; packKey: string }>;
}) {
  const { id, packKey } = await params;
  await requireWorkspaceAccess(id);

  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) notFound();

  const pack = getPack(packKey);
  if (!pack) notFound();

  const documentsReady = await prisma.document.count({
    where: { workspaceId: id, status: "ready" }
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href={`/deals/${id}/chat`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          &larr; {workspace.name} chat
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{pack.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{pack.description}</p>
        <p className="mt-1 text-xs text-slate-500">
          {pack.questions.length} questions · runs sequentially against
          {" "}
          {documentsReady} document{documentsReady === 1 ? "" : "s"} in this deal.
        </p>
      </div>

      {documentsReady === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Upload at least one document to this deal before running a pack.
        </div>
      ) : (
        <PackRunner
          workspaceId={id}
          pack={pack}
          threadTitle={`${pack.title} — ${workspace.name}`}
        />
      )}
    </div>
  );
}
