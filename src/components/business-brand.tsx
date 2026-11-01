import type { Branding } from "../core/branding";
/** Trusted inline geometry only. Nothing in a BuildPlan can provide SVG, HTML, CSS or a URL. */
export function BrandMark({ branding }: { branding: Branding }) {
  return (
    <span className="business-mark" aria-hidden="true">
      {branding.mark === "monogram" ? (
        branding.monogram
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          aria-hidden="true"
        >
          {branding.mark === "home" ? (
            <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
          ) : branding.mark === "sparkle" ? (
            <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z" />
          ) : branding.mark === "leaf" ? (
            <path d="M20 3C8 2 3 7 4 14c1 6 8 8 13 3 3-3 3-8 3-14ZM5 20 16 8" />
          ) : (
            <>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
export function BusinessIdentity({
  name,
  branding,
}: {
  name: string;
  branding: Branding;
}) {
  return (
    <span className="business-identity">
      <BrandMark branding={branding} />
      <span>
        <strong>{name}</strong>
        {branding.tagline && <small>{branding.tagline}</small>}
      </span>
    </span>
  );
}
