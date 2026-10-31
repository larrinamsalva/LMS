/** Maintenance commands are deliberately limited to explicitly named local fictional databases. */
export function localTarget(value: string | undefined, expectedName: string) {
  if (!value) throw new Error("An explicit local database URL is required.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    !url.username
  )
    throw new Error(
      "Maintenance commands require a loopback PostgreSQL URL without query parameters.",
    );
  if (
    !/^(lms_development|lms_test_[a-z0-9_]+|lms_restore_[a-z0-9_]+)$/.test(
      expectedName,
    ) ||
    decodeURIComponent(url.pathname.slice(1)) !== expectedName
  )
    throw new Error(
      "Confirm the exact fictional development/test/restore database name.",
    );
  return url;
}
export function sameDatabase(admin: URL, runtime: URL) {
  if (
    admin.hostname !== runtime.hostname ||
    admin.port !== runtime.port ||
    admin.pathname !== runtime.pathname
  )
    throw new Error(
      "Administrator and runtime URLs must address the same local database.",
    );
}
