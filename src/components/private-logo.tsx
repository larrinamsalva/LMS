import { useCallback, useEffect, useRef, useState } from "react";
import { logoLimits, logoStateSchema, type LogoAsset, type LogoState, type logoCommandSchema } from "../core/private-logo";
import type { z } from "zod";
export type LogoController = ReturnType<typeof usePrivateLogo>;
/** Asset state is separate from all configuration, draft, comparison and export paths. */
export function usePrivateLogo(organizationId?: string) {
  const [received, setReceived] = useState<{ org: string; state: LogoState } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  const request = useCallback(async (method = "GET", body?: BodyInit, revision?: number, operationId?: string) => {
    if (!organizationId) return false;
    const ticket = ++sequence.current, org = organizationId;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ organizationId: org });
      if (method === "POST") { query.set("revision", String(revision)); query.set("operationId", operationId!); }
      const response = await fetch("/api/demo/logo?" + query, { method, cache: "no-store", ...(body ? { body, headers: { "Content-Type": method === "POST" ? "application/octet-stream" : "application/json" } } : {}) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401 && sequence.current === ticket) setReceived(null);
        throw new Error(value.error ?? "Private logo request failed.");
      }
      const state = logoStateSchema.parse(value);
      if (sequence.current === ticket) setReceived({ org, state });
      return sequence.current === ticket;
    } catch (error) {
      if (sequence.current === ticket) setError(error instanceof Error && error.name !== "ZodError" ? error.message : "Private logo state is unavailable. Refresh before continuing.");
      return false;
    } finally { if (sequence.current === ticket) setBusy(false); }
  }, [organizationId]);
  useEffect(() => {
    setReceived(null); setError("");
    if (organizationId) void request();
    return () => { sequence.current++; };
  }, [organizationId, request]);
  const state = received && received.org === organizationId ? received.state : null;
  const deadline = state ? Math.min(state.expiresAt, state.staged?.expiresAt ?? state.expiresAt) : undefined;
  useEffect(() => {
    if (!deadline) return;
    const timer = setTimeout(() => void request(), Math.max(10, deadline - Date.now() + 10));
    return () => clearTimeout(timer);
  }, [deadline, request]);
  return {
    state, busy, error, refresh: () => request(),
    stage: async (file: File) => {
      if (file.size > logoLimits.inputBytes || !file.size) { setError("Choose a nonempty logo no larger than 1 MiB."); return false; }
      return state ? request("POST", file, state.revision, crypto.randomUUID()) : false;
    },
    command: (action: z.infer<typeof logoCommandSchema>["action"], asset: LogoAsset, display?: "square" | "rectangle") => state ? request("PATCH", JSON.stringify({ action, assetId: asset.id, revision: state.revision, operationId: crypto.randomUUID(), ...(display ? { display } : {}) })) : Promise.resolve(false),
  };
}
export function CustomLogoStudio({ controller, canManage }: { controller: LogoController; canManage: boolean }) {
  const { state, busy, error } = controller;
  const [file, setFile] = useState<File | null>(null), picker = useRef<HTMLInputElement>(null);
  const candidate = state?.staged ?? state?.selected;
  return <section className="studio-review" aria-labelledby="custom-logo-heading">
    <h4 id="custom-logo-heading">Custom Business Logo</h4>
    <p>Private, temporary image preview for this organization only. It is separate from saved branding and is never included in JSON, blueprint ZIPs, signatures or configuration publication.</p>
    <p className="muted">Static PNG, JPEG or WebP · up to 1 MiB, 4096 pixels per side and 1,048,576 decoded pixels. The server checks actual bytes, decodes and re-encodes a metadata-free PNG up to 512 × 512 and 256 KiB. Use a fictional logo only.</p>
    {!canManage && <p>Only owners/admins can stage, select, replace or remove logos.</p>}
    {error && <p className="error" role="alert">{error} Your current session logo was not replaced. Refresh private logos before retrying a stale operation.</p>}
    <label htmlFor="custom-logo-file">Select a logo image from this device</label>
    <input ref={picker} id="custom-logo-file" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busy || !canManage || !state} onChange={e => setFile(e.target.files?.[0] ?? null)} />
    <div className="actions">
      <button type="button" disabled={busy || !canManage || !state || !file} onClick={() => { if (file) void controller.stage(file).then(ok => { if (ok) { setFile(null); if (picker.current) picker.current.value = ""; } }); }}>{state?.staged ? "Replace staged image" : "Sanitize and stage logo"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => void controller.refresh()}>Refresh private logos</button>
    </div>
    {busy && <p role="status">Checking private logo state…</p>}
    {state && <p className="muted">{state.remainingUploads} upload attempts remain for this organization/session. Staged images expire after 10 minutes; selected images expire with the two-hour demo or server restart. Removing an image does not reset quotas.</p>}
    {candidate && <>
      <p role="status">{state?.staged ? "Sanitized image staged for review. The workspace still uses its current identity." : "Session logo selected. This is a temporary overlay, not published portable branding."}</p>
      <label htmlFor="custom-logo-display">Contained logo display</label>
      <select id="custom-logo-display" disabled={busy || !canManage} value={candidate.display} onChange={e => void controller.command("layout", candidate, e.target.value as "square" | "rectangle")}><option value="square">Square · contain the whole image</option><option value="rectangle">Rectangle · contain the whole image</option></select>
      <p className="muted">{candidate.width} × {candidate.height} sanitized pixels. Preview it below against both themes.</p>
    </>}
    <div className="actions">
      {state?.staged && <>
        <button type="button" disabled={busy || !canManage} onClick={() => void controller.command("select", state.staged!)}>{state.selected ? "Replace session logo with staged image" : "Use staged logo for this session"}</button>
        <button type="button" className="secondary" disabled={busy || !canManage} onClick={() => void controller.command("remove", state.staged!)}>Remove staged image</button>
      </>}
      {state?.selected && <button type="button" className="secondary" disabled={busy || !canManage} onClick={() => void controller.command("remove", state.selected!)}>Use built-in logo for this session</button>}
    </div>
    <p className="muted">Separate Engine previews are independent organizations and keep their portable built-in mark; private images are not copied to them. Select an image here to see it in this organization's dashboard identity. Portable image branding needs a future reviewed format.</p>
  </section>;
}
