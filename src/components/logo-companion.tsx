import { useEffect, useRef, useState } from "react";
import {
  inspectLogoCompanion,
  LOGO_COMPANION_LIMIT,
  type LogoCompanionManifest,
} from "../core/logo-companion";
import type { LogoController } from "./private-logo";

export function LogoCompanionTools({
  controller,
  canManage,
}: {
  controller: LogoController;
  canManage: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [review, setReview] = useState<{
      bytes: Uint8Array<ArrayBuffer>;
      manifest: LogoCompanionManifest;
    } | null>(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const sequence = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (review) heading.current?.focus();
  }, [review]);
  async function inspect() {
    const ticket = ++sequence.current;
    setReview(null);
    setError("");
    setNotice("");
    setChecking(true);
    try {
      if (!file || !file.size || file.size > LOGO_COMPANION_LIMIT)
        throw new Error(
          "Choose a nonempty logo companion no larger than 260 KiB.",
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { manifest } = await inspectLogoCompanion(bytes);
      if (sequence.current === ticket) {
        setReview({ bytes, manifest });
      }
    } catch (error) {
      if (sequence.current === ticket)
        setError(
          error instanceof Error ? error.message : "Logo companion refused.",
        );
    } finally {
      if (sequence.current === ticket) setChecking(false);
    }
  }
  const disabled =
    controller.busy || checking || !canManage || !controller.state;
  return (
    <section aria-labelledby="save-logo-heading" className="studio-review">
      <h5 id="save-logo-heading">Save My Logo</h5>
      <p>
        Save only your explicitly selected, sanitized session image. Your device
        keeps the downloaded file; LMS keeps its copy private and temporary.
      </p>
      <div className="actions">
        {(["png", "companion"] as const).map((format) => (
          <button
            key={format}
            type="button"
            className="secondary"
            disabled={disabled || !controller.state?.selected}
            onClick={() => {
              setNotice("");
              void controller.save(format).then((ok) => {
                if (ok)
                  setNotice(
                    "Logo download prepared. No branding, draft or business record was changed.",
                  );
              });
            }}
          >
            {format === "png"
              ? "Download sanitized PNG"
              : "Download logo companion"}
          </button>
        ))}
      </div>
      <p className="muted">
        The separate companion contains the PNG, contained display layout and
        integrity manifest. It is never bundled into a Blueprint ZIP or covered
        by its publisher signature. Portable branding publication is not yet
        supported.
      </p>
      <label htmlFor="logo-companion-file">Import logo companion</label>
      <input
        id="logo-companion-file"
        type="file"
        accept=".zip,application/zip"
        disabled={disabled}
        onChange={(e) => {
          sequence.current++;
          setFile(e.target.files?.[0] ?? null);
          setReview(null);
          setError("");
          setNotice("");
          setChecking(false);
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={disabled || !file}
        onClick={() => void inspect()}
      >
        Review logo companion
      </button>
      {checking && (
        <p role="status">Checking companion structure and image integrity…</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error} No image was staged or selected.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {review && (
        <div
          className="studio-review"
          role="region"
          aria-labelledby="review-logo-heading"
        >
          <h6 id="review-logo-heading" tabIndex={-1} ref={heading}>
            Review logo companion
          </h6>
          <p>
            <strong>Image integrity verified.</strong> Publisher authenticity
            not established. This is a standalone data asset, not a signed
            blueprint.
          </p>
          <dl>
            <dt>Image</dt>
            <dd>
              PNG · {review.manifest.image.width} ×{" "}
              {review.manifest.image.height} pixels ·{" "}
              {review.manifest.image.bytes} bytes
            </dd>
            <dt>Contained layout</dt>
            <dd>{review.manifest.display}</dd>
            <dt>Image SHA-256</dt>
            <dd className="logo-digest">{review.manifest.image.sha256}</dd>
          </dl>
          <p>
            Integrity does not prove image safety. Explicit staging runs the
            server's image checks and re-encoding again and uses an upload
            attempt. Review the sanitized light/dark samples, then separately
            select the image for this organization.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const ticket = sequence.current;
              void controller.stageCompanion(review.bytes).then((ok) => {
                if (ok && sequence.current === ticket) {
                  setReview(null);
                  setNotice(
                    "Companion sanitized and staged. Select the staged image explicitly to use it in this temporary workspace.",
                  );
                }
              });
            }}
          >
            Sanitize and stage companion
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => {
              sequence.current++;
              setReview(null);
              setNotice("");
            }}
          >
            Cancel companion review
          </button>
        </div>
      )}
      {controller.state?.staged?.companion && (
        <p className="muted">
          Companion image integrity checked; sanitized again. Publisher
          authenticity not established. This image is staged, not selected or
          published.
        </p>
      )}
      {controller.state?.selected?.companion && (
        <p className="muted">
          Temporary private logo selected from a companion. Publisher
          authenticity not established. Portable branding publication is not yet
          supported.
        </p>
      )}
    </section>
  );
}
