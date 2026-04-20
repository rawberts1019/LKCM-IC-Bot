import Link from "next/link";
import { requireUser } from "@/lib/access";
import { listForUser } from "@/lib/notifications";
import { formatDateTime } from "@/lib/utils";
import { markAllRead, markRead } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  "answer.ready": "Answer ready",
  "answer.reply": "Deal team replied",
  "review.new": "New review queue item"
};

export default async function NotificationsPage() {
  const user = await requireUser();
  const rows = await listForUser(user.id);
  const unread = rows.filter((r) => !r.readAt).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-600">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllRead}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No notifications yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-4 px-4 py-3 ${
                n.readAt ? "bg-white" : "bg-amber-50/40"
              }`}
            >
              <Link
                href={n.targetUrl}
                className="min-w-0 flex-1"
                // Mark read on click via form; link still navigates because
                // the form action below is hidden and the link is the outer element.
              >
                <div className="flex items-center gap-2">
                  {!n.readAt ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                      aria-label="Unread"
                    />
                  ) : null}
                  <span className="text-sm font-medium text-slate-900">{n.title}</span>
                </div>
                {n.body ? (
                  <div className="mt-0.5 truncate text-xs text-slate-600">{n.body}</div>
                ) : null}
                <div className="mt-1 text-xs text-slate-500">
                  {TYPE_LABEL[n.type] ?? n.type}
                  {n.workspace ? ` · ${n.workspace.dealCode ?? n.workspace.name}` : ""}
                  {" · "}
                  {formatDateTime(n.createdAt)}
                </div>
              </Link>
              {!n.readAt ? (
                <form
                  action={async () => {
                    "use server";
                    await markRead(n.id);
                  }}
                >
                  <button
                    type="submit"
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Mark read
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
