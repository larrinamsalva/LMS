/** Descriptive employee titles do not grant permissions. Managed records use existing owner/admin roles. */
const managed = new Set([
  "employees",
  "resource-memberships",
  "availability",
  "pricing-zones",
  "services",
  "service-rates",
  "estimates",
]);
export const recordWriteRoles = (entity: string) =>
  managed.has(entity) ? ["owner", "admin"] : ["owner", "admin", "staff"];
