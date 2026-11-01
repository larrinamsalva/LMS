/** Descriptive employee titles do not grant permissions. Managed records use existing owner/admin roles. */
const managed = new Set([
  "items",
  "stock-locations",
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

export const movementWriteRoles = (data: Record<string, unknown>) =>
  String(data.action).startsWith("Adjustment") || data.correction
    ? ["owner", "admin"]
    : ["owner", "admin", "staff"];
