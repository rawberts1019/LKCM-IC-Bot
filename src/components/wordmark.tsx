import Link from "next/link";

/**
 * LKCM Headwater wordmark.
 *
 * Renders the official logo from /public/lkcm-headwater-logo.svg. Variants:
 *   - compact: app header (small logo + "IC Bot" subtitle)
 *   - full:    login + print/export (larger logo, centered)
 */

const LOGO_PATH = "/lkcm-headwater-logo.svg";
const LOGO_ASPECT = 482 / 108; // native SVG viewBox ratio

export function Wordmark({
  variant = "compact",
  linkTo
}: {
  variant?: "compact" | "full";
  linkTo?: string;
}) {
  const body = variant === "compact" ? <CompactMark /> : <FullMark />;
  if (linkTo) {
    return (
      <Link href={linkTo} className="inline-flex items-center gap-3">
        {body}
      </Link>
    );
  }
  return body;
}

function CompactMark() {
  const height = 26;
  return (
    <span className="inline-flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_PATH}
        alt="LKCM Headwater Investments"
        height={height}
        width={Math.round(height * LOGO_ASPECT)}
        style={{ height: `${height}px`, width: "auto" }}
      />
      <span
        aria-hidden
        className="h-6 w-px bg-slate-300"
      />
      <span className="text-sm font-semibold text-slate-600">IC Bot</span>
    </span>
  );
}

function FullMark() {
  const height = 72;
  return (
    <div className="inline-flex flex-col items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_PATH}
        alt="LKCM Headwater Investments"
        height={height}
        width={Math.round(height * LOGO_ASPECT)}
        style={{ height: `${height}px`, width: "auto" }}
      />
    </div>
  );
}
