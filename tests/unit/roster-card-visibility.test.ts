import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  rosterCardCollapseKey,
  setShownRosterCardsCollapsed,
} from "../../src/core/roster-card-visibility";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function resource(id: string, organization_id = ORG): WorkspaceRecord {
  return {
    id, organization_id, entity: "resources",
    data: { name: "Fictional resource " + id, kind: "Crew" },
    archived: false, revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const first = resource("first");
const second = resource("second");
const hidden = resource("filtered-away");
const foreign = resource("outside", OTHER);
const foreignCollision = resource("first", OTHER);

it("bulk collapse touches only visible authorized cards and preserves hidden/foreign state", () => {
  const prior = [
    rosterCardCollapseKey(ORG, hidden.id),
    rosterCardCollapseKey(OTHER, foreign.id),
  ];
  const old = [...prior];
  const shown = [first, second, foreign, foreignCollision];
  const before = structuredClone(shown);
  const collapsed = setShownRosterCardsCollapsed(prior, shown, ORG, true);
  expect(collapsed).toEqual([
    ...prior,
    rosterCardCollapseKey(ORG, first.id),
    rosterCardCollapseKey(ORG, second.id),
  ]);
  expect(prior).toEqual(old);
  expect(shown).toEqual(before);
  expect(collapsed).not.toContain(rosterCardCollapseKey(OTHER, first.id));
  expect(setShownRosterCardsCollapsed(collapsed, shown, ORG, false))
    .toEqual(prior);
});

it("bulk expansion preserves unrelated collapsed cards and duplicate input order", () => {
  const previous = [
    rosterCardCollapseKey(ORG, first.id),
    rosterCardCollapseKey(ORG, second.id),
    rosterCardCollapseKey(ORG, hidden.id),
    rosterCardCollapseKey(OTHER, first.id),
  ];
  expect(setShownRosterCardsCollapsed(
    previous, [first, first], ORG, true,
  )).toEqual(previous);
  expect(setShownRosterCardsCollapsed(
    previous, [second], ORG, false,
  )).toEqual([
    rosterCardCollapseKey(ORG, first.id),
    rosterCardCollapseKey(ORG, hidden.id),
    rosterCardCollapseKey(OTHER, first.id),
  ]);
  expect(setShownRosterCardsCollapsed(previous, [], ORG, false))
    .toEqual(previous);
});

it("rejects nonresource and foreign rows even when caller supplies mixed records", () => {
  const wrongEntity: WorkspaceRecord = {
    ...resource("not-a-card"), entity: "resource-memberships",
  };
  const previous = [rosterCardCollapseKey(OTHER, foreign.id)];
  expect(setShownRosterCardsCollapsed(
    previous, [wrongEntity, foreign, first], ORG, true,
  )).toEqual([
    rosterCardCollapseKey(OTHER, foreign.id),
    rosterCardCollapseKey(ORG, first.id),
  ]);
  expect(setShownRosterCardsCollapsed(
    previous, [foreign, wrongEntity], ORG, false,
  )).toEqual(previous);
});
