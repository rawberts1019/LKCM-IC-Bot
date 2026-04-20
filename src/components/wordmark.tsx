import Link from "next/link";

/**
 * LKCM Headwater wordmark.
 *
 * - "compact" fits inside the app header (single line, vertically stacked label).
 * - "full" is the three-line logo treatment used on the login page and
 *   the IC-memo export header.
 *
 * If we later want the actual logo SVG/PNG, replace the inner JSX with an
 * <Image> tag pointing at /public/lkcm-headwater-logo.svg — nothing else
 * in the app needs to change.
 */

export function Wordmark({
  variant = "compact",
  linkTo
}: {
  variant?: "compact" | "full";
  linkTo?: string;
}) {
  const body =
    variant === "compact" ? <CompactMark /> : <FullMark />;
  if (linkTo) {
    return (
      <Link href={linkTo} className="inline-flex items-baseline gap-2">
        {body}
      </Link>
    );
  }
  return body;
}

function CompactMark() {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span
        className="text-[0.65rem] font-semibold uppercase"
        style={{ color: "var(--color-brand)", letterSpacing: "0.18em" }}
      >
        LKCM
      </span>
      <span
        className="text-base font-semibold tracking-wide text-slate-900"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Headwater
      </span>
      <span className="text-sm font-semibold text-slate-500">IC Bot</span>
    </span>
  );
}

function FullMark() {
  return (
    <div className="inline-flex flex-col items-center leading-none">
      <div
        className="text-xs font-semibold"
        style={{ color: "var(--color-brand)", letterSpacing: "0.24em" }}
      >
        LKCM
      </div>
      <div className="relative mt-1">
        <div
          className="text-3xl font-semibold text-slate-900"
          style={{ fontFamily: "var(--font-serif)", letterSpacing: "0.04em" }}
        >
          HEADWATER
        </div>
        {/* Stylized wave accent under the 'H', echoing the actual logo */}
        <svg
          aria-hidden
          className="absolute -top-1 left-0"
          width="26"
          height="10"
          viewBox="0 0 60 14"
          style={{ color: "var(--color-brand-accent)" }}
          fill="none"
        >
          <path
            d="M2 7 C 10 2, 18 12, 26 7 S 42 2, 58 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div
        className="mt-1 text-[0.6rem] font-semibold"
        style={{ color: "var(--color-brand)", letterSpacing: "0.3em" }}
      >
        INVESTMENTS
      </div>
    </div>
  );
}
