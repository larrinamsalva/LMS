import type { Branding } from "../core/branding";
import { useState } from "react";
import { privateLogoUrl, type LogoAsset } from "../core/private-logo";
export type PrivateLogo = { organizationId: string; asset: LogoAsset };
export function BusinessLogo({ logo, name, branding }: { logo?: PrivateLogo; name: string; branding: Branding }) {
  return logo ? <LogoImage key={logo.organizationId + ":" + logo.asset.id} logo={logo} name={name} branding={branding} /> : <BrandMark branding={branding} />;
}
function LogoImage({ logo, name, branding }: { logo: PrivateLogo; name: string; branding: Branding }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="logo-fallback"><BrandMark branding={branding} /><small>Logo unavailable · built-in fallback</small></span> : <span className={"private-logo private-logo-" + logo.asset.display}><img src={privateLogoUrl(logo.organizationId, logo.asset.id)} alt={name + " logo (temporary session preview)"} width={logo.asset.width} height={logo.asset.height} onError={() => setFailed(true)} /></span>;
}
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
  logo,
}: {
  name: string;
  branding: Branding;
  logo?: PrivateLogo;
}) {
  return (
    <span className="business-identity">
      <BusinessLogo name={name} branding={branding} logo={logo} />
      <span>
        <strong>{name}</strong>
        {branding.tagline && <small>{branding.tagline}</small>}
      </span>
    </span>
  );
}
