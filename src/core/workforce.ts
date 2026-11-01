import type { EntityDefinition, RecordData } from "./config";
import { instant, isTimeZone, localDate, TimeError } from "./time";

export const workforceEntities = [
  "employees",
  "resource-memberships",
  "availability",
];
export const availabilityKinds = [
  "Working hours",
  "Day off",
  "Vacation",
  "Unavailable",
] as const;
/** Profile/job titles never grant application permissions. */
export const recordWriteRoles = (entity: string) =>
  workforceEntities.includes(entity)
    ? ["owner", "admin"]
    : ["owner", "admin", "staff"];

export function workforceContract(entity: EntityDefinition) {
  if (!workforceEntities.includes(entity.id)) return true;
  const contract: Record<string, string> =
    entity.id === "employees"
      ? { name: "text", role: "text", status: "select" }
      : {
          title: "text",
          start: "datetime",
          end: "datetime",
          time_zone: "text",
          ...(entity.id === "resource-memberships"
            ? { employee: "reference", resource: "reference" }
            : { kind: "select" }),
        };
  return (
    entity.module === "workforce" &&
    Object.entries(contract).every(([key, type]) =>
      entity.fields.some((f) => f.key === key && f.type === type && f.required),
    ) &&
    (entity.id === "employees"
      ? JSON.stringify(
          entity.fields.find((f) => f.key === "status")?.options,
        ) === JSON.stringify(["Active", "Inactive"])
      : [
          ["employee", "employees"],
          ["resource", "resources"],
        ].every(([key, target]) =>
          entity.fields.some(
            (f) =>
              f.key === key &&
              f.type === "reference" &&
              f.target === target &&
              f.required === (entity.id === "resource-memberships"),
          ),
        ) &&
        (entity.id !== "availability" ||
          JSON.stringify(
            entity.fields.find((f) => f.key === "kind")?.options,
          ) === JSON.stringify(availabilityKinds)))
  );
}

export function validateWorkforceRecord(entity: string, data: RecordData) {
  if (!["resource-memberships", "availability"].includes(entity)) return;
  const zone = String(data.time_zone);
  if (!isTimeZone(zone)) throw new TimeError("Choose a valid IANA time zone.");
  const start = instant(String(data.start)),
    end = instant(String(data.end));
  if (
    end.epochNanoseconds <= start.epochNanoseconds ||
    start.epochNanoseconds % 60_000_000_000n ||
    end.epochNanoseconds % 60_000_000_000n ||
    [data.start, data.end].some((v) => {
      const date = localDate(String(v), zone);
      return date < "2020-01-01" || date > "2100-12-31";
    })
  )
    throw new TimeError("Use a positive whole-minute period within 2020–2100.");
  if (entity === "availability") {
    if (!!data.employee === !!data.resource)
      throw new TimeError(
        "Choose exactly one employee or resource for availability.",
      );
    const maxDays = data.kind === "Working hours" ? 1 : 366;
    if (
      end.epochNanoseconds - start.epochNanoseconds >
      BigInt(maxDays) * 86400_000_000_000n
    )
      throw new TimeError(
        data.kind === "Working hours"
          ? "A work window covers at most 24 elapsed hours."
          : "Time off covers at most 366 elapsed days.",
      );
  }
}

/** Trigger-maintained assignment snapshots, including released historical revisions. */
export interface StaffAssignment {
  organization_id: string;
  appointment_id: string;
  appointment_revision: number;
  employee_id: string;
  resource_id: string;
  membership_id: string;
  membership_revision: number;
  member_start: string | Date;
  member_end: string | Date;
  employee_name: string;
  employee_role: string;
  employee_skills: string;
  starts_at: string | Date;
  ends_at: string | Date;
  active: boolean;
}
