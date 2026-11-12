import { Temporal } from "@js-temporal/polyfill";

/**
 * A single, ephemeral "return" token for an explicit forward jump
 * through saved-rate review dates. It contains no business records.
 */
export interface RateReviewJump {
  organizationId: string;
  previousDate: string;
  areaId: string;
  jumpedDate: string;
}
function validDate(date: string): boolean {
  try {
    return Temporal.PlainDate.from(date).toString() === date;
  } catch {
    return false;
  }
}
/** Only save a forward jump from one valid explicit date to another. */
export function rememberRateReviewJump(
  organizationId: string,
  previousDate: string,
  areaId: string,
  jumpedDate: string,
): RateReviewJump | null {
  if (!organizationId || !validDate(previousDate) ||
      !validDate(jumpedDate) || jumpedDate <= previousDate) return null;
  return { organizationId, previousDate, areaId, jumpedDate };
}

/**
 * Never offer a stale return after switching organizations, editing
 * the selected date or choosing another area.
 */
export function returnableRateReviewDate(
  jump: RateReviewJump | null,
  organizationId: string,
  currentDate: string,
  areaId: string,
): string | null {
  if (!jump || jump.organizationId !== organizationId ||
      jump.jumpedDate !== currentDate || jump.areaId !== areaId ||
      !validDate(jump.previousDate)) return null;
  return jump.previousDate;
}
