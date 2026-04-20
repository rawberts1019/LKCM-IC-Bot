"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addMember } from "../actions";

type Suggestion = {
  id: string;
  displayName: string | null;
  mail: string | null;
  jobTitle: string | null;
};

export function MemberAddForm({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"owner" | "dealteam" | "ic">("ic");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/directory/search?q=${encodeURIComponent(query.trim())}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) {
          setSuggestions([]);
        } else {
          const data = (await res.json()) as { results: Suggestion[] };
          setSuggestions(data.results ?? []);
        }
      } catch {
        // aborted or network error; ignore
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function submitWithEmail(email: string) {
    if (!email) {
      setError("Pick someone or type an email.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("workspaceId", workspaceId);
    fd.append("email", email);
    fd.append("role", role);
    startTransition(async () => {
      try {
        await addMember(fd);
        setQuery("");
        setSuggestions([]);
        setShowSuggestions(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add member.");
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // If user typed a full email, use it directly; otherwise require picking
    // a suggestion.
    if (query.includes("@")) {
      submitWithEmail(query.trim());
    } else if (suggestions[0]?.mail) {
      submitWithEmail(suggestions[0].mail);
    } else {
      setError("Pick a person from the list or type a full email.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <label htmlFor="member-query" className="block text-xs font-medium text-slate-700">
            Add member
          </label>
          <input
            id="member-query"
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
              setError(null);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Type a name or email…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            disabled={isPending}
          />
          {showSuggestions && (suggestions.length > 0 || loading) ? (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {loading ? (
                <li className="px-3 py-2 text-xs text-slate-500">Searching…</li>
              ) : (
                suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        // onMouseDown fires before the input's onBlur hides the list
                        e.preventDefault();
                        if (s.mail) submitWithEmail(s.mail);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      disabled={!s.mail}
                    >
                      <div className="font-medium text-slate-900">
                        {s.displayName ?? s.mail}
                      </div>
                      <div className="text-xs text-slate-500">
                        {s.mail ?? "no email"}
                        {s.jobTitle ? ` · ${s.jobTitle}` : ""}
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>

        <div>
          <label htmlFor="member-role" className="block text-xs font-medium text-slate-700">
            Role
          </label>
          <select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={isPending}
          >
            <option value="ic">IC (read/ask)</option>
            <option value="dealteam">Deal team</option>
            <option value="owner">Owner</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">
        Suggestions come live from the LKCM directory. Pick someone or type a full email.
      </p>
    </form>
  );
}
