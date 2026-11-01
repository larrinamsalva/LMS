import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LogoVault } from "../../src/server/logo-vault";
import * as sanitizer from "../../src/server/logo-sanitizer";
import { logoFixture } from "../helpers/logo-fixtures";
import {
  createLogoCompanion,
  inspectLogoCompanion,
} from "../../src/core/logo-companion";
import { blueprintJson, sha256 } from "../../src/core/blueprint";
import {
  blueprintText,
  crc32,
  writeArchive,
} from "../../src/core/stored-archive";
import sharp from "sharp";
const vaults: LogoVault[] = [];
afterEach(() => {
  for (const v of vaults.splice(0)) v.close();
  vi.restoreAllMocks();
});
function setup() {
  const vault = new LogoVault();
  vaults.push(vault);
  return {
    vault,
    owner: { expiresAt: Date.now() + 7200000 },
    org: randomUUID(),
    other: randomUUID(),
  };
}
it("stages separately, explicitly selects, replaces, changes contained layout and removes only exact scoped revisions", async () => {
  const { vault, owner, org, other } = setup(),
    bytes = await logoFixture(),
    operationId = randomUUID(),
    state = await vault.stage(
      owner,
      org,
      bytes,
      0,
      operationId,
      async () => {},
    );
  expect(state.selected).toBeNull();
  expect(state.staged).not.toBeNull();
  expect(
    await vault.stage(owner, org, bytes, 0, operationId, async () => {}),
  ).toEqual(state);
  expect(() => vault.image(owner, other, state.staged!.id, true)).toThrow(
    /unavailable/,
  );
  expect(() => vault.image(owner, org, state.staged!.id, false)).toThrow(
    /unavailable/,
  );
  const selected = vault.command(owner, org, {
    action: "select",
    assetId: state.staged!.id,
    revision: 1,
    operationId: randomUUID(),
  });
  const next = await vault.stage(
    owner,
    org,
    bytes,
    selected.revision,
    randomUUID(),
    async () => {},
  );
  expect(next.selected).toEqual(selected.selected);
  expect(next.staged!.id).not.toBe(selected.selected!.id);
  expect(() =>
    vault.command(owner, org, {
      action: "remove",
      assetId: next.selected!.id,
      revision: 1,
      operationId: randomUUID(),
    }),
  ).toThrow(/changed/);
  const shaped = vault.command(owner, org, {
    action: "layout",
    assetId: next.staged!.id,
    revision: next.revision,
    operationId: randomUUID(),
    display: "rectangle",
  });
  const replaced = vault.command(owner, org, {
    action: "select",
    assetId: shaped.staged!.id,
    revision: shaped.revision,
    operationId: randomUUID(),
  });
  expect(replaced.selected!.display).toBe("rectangle");
  expect(() => vault.image(owner, org, selected.selected!.id, true)).toThrow(
    /unavailable/,
  );
  const removed = vault.command(owner, org, {
    action: "remove",
    assetId: replaced.selected!.id,
    revision: replaced.revision,
    operationId: randomUUID(),
  });
  expect(removed.selected).toBeNull();
  expect(removed.staged).toBeNull();
  expect(vault.state(owner, other).revision).toBe(0);
});
it("refuses competing writes, conflicting replay and lost authorization without replacing existing assets", async () => {
  const { vault, owner, org } = setup(),
    bytes = await logoFixture(),
    first = await vault.stage(
      owner,
      org,
      bytes,
      0,
      randomUUID(),
      async () => {},
    );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    id = randomUUID();
  const pending = vault.stage(
    owner,
    org,
    bytes,
    first.revision,
    id,
    async () => gate,
  );
  await expect(
    vault.stage(
      owner,
      org,
      bytes,
      first.revision,
      randomUUID(),
      async () => {},
    ),
  ).rejects.toMatchObject({ status: 423 });
  expect(() =>
    vault.command(owner, org, {
      action: "remove",
      assetId: first.staged!.id,
      revision: 1,
      operationId: randomUUID(),
    }),
  ).toThrow(/busy/);
  release();
  const after = await pending;
  await expect(
    vault.stage(
      owner,
      org,
      Buffer.from("changed"),
      first.revision,
      id,
      async () => {},
    ),
  ).rejects.toThrow(/different choices/);
  await expect(
    vault.stage(owner, org, bytes, after.revision, randomUUID(), async () => {
      throw new Error("authorization revoked");
    }),
  ).rejects.toThrow(/revoked/);
  expect(vault.state(owner, org).staged!.id).toBe(after.staged!.id);
});
it("retains quotas across removal/failures, bounds idempotency history and refuses failed retries", async () => {
  const { vault, owner, org } = setup();
  for (let i = 0; i < 12; i++) {
    const id = randomUUID();
    await expect(
      vault.stage(owner, org, Buffer.from("hostile"), 0, id, async () => {}),
    ).rejects.toThrow();
    await expect(
      vault.stage(owner, org, Buffer.from("hostile"), 0, id, async () => {}),
    ).rejects.toThrow(/earlier/);
  }
  expect(vault.state(owner, org).remainingUploads).toBe(0);
  await expect(
    vault.stage(
      owner,
      org,
      await logoFixture(),
      0,
      randomUUID(),
      async () => {},
    ),
  ).rejects.toMatchObject({ status: 429 });
});
it("expires staged bytes, never rolls back revisions and clears expired sessions without affecting another owner", async () => {
  const { vault, owner, org } = setup(),
    bytes = await logoFixture(),
    first = await vault.stage(
      owner,
      org,
      bytes,
      0,
      randomUUID(),
      async () => {},
    ),
    other = { expiresAt: owner.expiresAt + 7200000 };
  const otherAsset = await vault.stage(
    other,
    org,
    bytes,
    0,
    randomUUID(),
    async () => {},
  );
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 600001);
  vault.sweep();
  expect(vault.state(owner, org).staged).toBeNull();
  expect(vault.state(owner, org).revision).toBe(2);
  expect(() => vault.image(owner, org, first.staged!.id, true)).toThrow();
  vi.mocked(Date.now).mockReturnValue(now); // A backward clock cannot resurrect removed bytes or the prior revision.
  expect(vault.state(owner, org).revision).toBe(2);
  const fresh = await vault.stage(
    other,
    org,
    bytes,
    vault.state(other, org).revision,
    randomUUID(),
    async () => {},
  );
  vault.command(other, org, {
    action: "select",
    assetId: fresh.staged!.id,
    revision: fresh.revision,
    operationId: randomUUID(),
  });
  vi.mocked(Date.now).mockReturnValue(owner.expiresAt + 1);
  vault.sweep();
  expect(() => vault.state(owner, org)).toThrow(/ended/);
  expect(vault.state(other, org).selected!.id).not.toBe(otherAsset.staged!.id);
});
it("bounds competing decoders globally and refuses expiration during processing without retaining a result", async () => {
  const { vault, owner, org, other } = setup(),
    bytes = await logoFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const first = vault.stage(
    owner,
    org,
    bytes,
    0,
    randomUUID(),
    async () => gate,
  );
  const second = vault.stage(
    owner,
    other,
    bytes,
    0,
    randomUUID(),
    async () => gate,
  );
  await expect(
    vault.stage(owner, randomUUID(), bytes, 0, randomUUID(), async () => {}),
  ).rejects.toMatchObject({ status: 429 });
  release();
  await Promise.all([first, second]);
  await expect(
    vault.stage(owner, org, bytes, 1, randomUUID(), async () => {
      owner.expiresAt = Date.now() - 1;
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(() => vault.state(owner, org)).toThrow(/ended/);
});
it("keeps a reserved cleanup path after the mutation quota without deleting unknown or stale asset IDs", async () => {
  const { vault, owner, org } = setup(),
    bytes = await logoFixture();
  let state = await vault.stage(
    owner,
    org,
    bytes,
    0,
    randomUUID(),
    async () => {},
  );
  state = vault.command(owner, org, {
    action: "select",
    assetId: state.staged!.id,
    revision: state.revision,
    operationId: randomUUID(),
  });
  state = await vault.stage(
    owner,
    org,
    bytes,
    state.revision,
    randomUUID(),
    async () => {},
  );
  for (let i = 0; i < 61; i++)
    state = vault.command(owner, org, {
      action: "layout",
      assetId: state.staged!.id,
      revision: state.revision,
      operationId: randomUUID(),
      display: i % 2 ? "square" : "rectangle",
    });
  await expect(
    vault.stage(
      owner,
      org,
      bytes,
      state.revision,
      randomUUID(),
      async () => {},
    ),
  ).rejects.toMatchObject({ status: 429 });
  expect(() =>
    vault.command(owner, org, {
      action: "remove",
      assetId: randomUUID(),
      revision: state.revision,
      operationId: randomUUID(),
    }),
  ).toThrow(/unavailable/);
  state = vault.command(owner, org, {
    action: "remove",
    assetId: state.selected!.id,
    revision: state.revision,
    operationId: randomUUID(),
  });
  state = vault.command(owner, org, {
    action: "remove",
    assetId: state.staged!.id,
    revision: state.revision,
    operationId: randomUUID(),
  });
  expect(state.selected).toBeNull();
  expect(state.staged).toBeNull();
});
it("enforces session and global storage reservations across owners without evicting their images", async () => {
  // Isolate vault accounting at the exact maximum output size; real native decoding is tested separately.
  vi.spyOn(sanitizer, "sanitizeLogo").mockImplementation(async () => ({
    bytes: Buffer.alloc(262144, 1),
    width: 512,
    height: 128,
  }));
  const { vault } = setup(),
    owners = Array.from({ length: 17 }, () => ({
      expiresAt: Date.now() + 7200000,
    })),
    bytes = Uint8Array.of(1);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 4; j++) {
      const org = "quota-" + j;
      let state = await vault.stage(
        owners[i],
        org,
        bytes,
        0,
        randomUUID(),
        async () => {},
      );
      state = vault.command(owners[i], org, {
        action: "select",
        assetId: state.staged!.id,
        revision: state.revision,
        operationId: randomUUID(),
      });
      await vault.stage(
        owners[i],
        org,
        bytes,
        state.revision,
        randomUUID(),
        async () => {},
      );
    }
  await expect(
    vault.stage(owners[0], "extra", bytes, 0, randomUUID(), async () => {}),
  ).rejects.toMatchObject({ status: 429 });
  await expect(
    vault.stage(owners[16], "extra", bytes, 0, randomUUID(), async () => {}),
  ).rejects.toMatchObject({ status: 429 });
  const retained = vault.state(owners[1], "quota-0");
  vault.drop(owners[0]);
  expect(vault.state(owners[1], "quota-0")).toEqual(retained);
  expect(
    (
      await vault.stage(
        owners[16],
        "extra",
        bytes,
        0,
        randomUUID(),
        async () => {},
      )
    ).staged,
  ).not.toBeNull();
});

it("exports only an exact selected revision, without consuming uploads, changing state or leaking shared buffers", async () => {
  const { vault, owner, org, other } = setup(),
    bytes = await logoFixture();
  const staged = await vault.stage(
    owner,
    org,
    bytes,
    0,
    randomUUID(),
    async () => {},
  );
  await expect(
    vault.saveSelected(owner, org, staged.staged!.id, 1, "png", async () => {}),
  ).rejects.toMatchObject({ status: 409 });
  const selected = vault.command(owner, org, {
    action: "select",
    assetId: staged.staged!.id,
    revision: 1,
    operationId: randomUUID(),
  });
  const png = await vault.saveSelected(
    owner,
    org,
    selected.selected!.id,
    2,
    "png",
    async () => {},
  );
  const zip = await vault.saveSelected(
    owner,
    org,
    selected.selected!.id,
    2,
    "companion",
    async () => {},
  );
  expect((await inspectLogoCompanion(zip)).image).toEqual(png);
  expect(vault.state(owner, org)).toEqual(selected);
  png.fill(0);
  expect(
    vault.image(owner, org, selected.selected!.id, true).length,
  ).toBeGreaterThan(0);
  for (const [who, group, id, rev] of [
    [owner, org, selected.selected!.id, 1],
    [owner, other, selected.selected!.id, 0],
    [{ expiresAt: owner.expiresAt }, org, selected.selected!.id, 2],
  ] as const)
    await expect(
      vault.saveSelected(who, group, id, rev, "companion", async () => {}),
    ).rejects.toMatchObject({ status: 409 });
});
it("imports into a new private owner with explicit staging, original integrity binding and unchanged source custody", async () => {
  const { vault, owner, org } = setup(),
    image = await logoFixture();
  const archive = await createLogoCompanion(image, {
    width: 128,
    height: 64,
    display: "rectangle",
  });
  const id = randomUUID(),
    recheck = vi.fn(async () => {}),
    sanitizerSpy = vi.spyOn(sanitizer, "sanitizeLogo");
  const staged = await vault.stage(
    owner,
    org,
    archive,
    0,
    id,
    recheck,
    "companion",
  );
  expect(staged.selected).toBeNull();
  expect(staged.staged!.display).toBe("rectangle");
  expect(staged.staged!.companion).toEqual({
    version: 1,
    imageSha256: await sha256(image),
  });
  expect(sanitizerSpy).toHaveBeenCalledTimes(1);
  expect(recheck).toHaveBeenCalledOnce();
  expect(
    await vault.stage(owner, org, archive, 0, id, recheck, "companion"),
  ).toEqual(staged);
  expect(sanitizerSpy).toHaveBeenCalledTimes(1);
  await expect(
    vault.stage(owner, org, archive, 0, id, recheck, "image"),
  ).rejects.toMatchObject({ status: 409 });
  const selected = vault.command(owner, org, {
    action: "select",
    assetId: staged.staged!.id,
    revision: 1,
    operationId: randomUUID(),
  });
  const saved = await vault.saveSelected(
    owner,
    org,
    selected.selected!.id,
    2,
    "companion",
    recheck,
  );
  const receiving = { expiresAt: owner.expiresAt },
    receivingOrg = randomUUID();
  const imported = await vault.stage(
    receiving,
    receivingOrg,
    saved,
    0,
    randomUUID(),
    recheck,
    "companion",
  );
  expect(imported.selected).toBeNull();
  expect(imported.staged!.id).not.toBe(selected.selected!.id);
  expect(vault.state(owner, org)).toEqual(selected);
  expect(() =>
    vault.image(receiving, org, selected.selected!.id, true),
  ).toThrow(/unavailable/);
});
it("re-sanitizes digest-valid PNG metadata and refuses hostile image content despite valid integrity", async () => {
  const { vault, owner, org } = setup(),
    image = await logoFixture();
  function chunk(type: string, data: Buffer) {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4);
    return b;
  }
  const withText = Buffer.concat([
    image.subarray(0, 33),
    chunk("tEXt", Buffer.from("Comment\0PRIVATE FICTIONAL METADATA")),
    image.subarray(33),
  ]);
  const good = await createLogoCompanion(withText, {
    width: 128,
    height: 64,
    display: "square",
  });
  const state = await vault.stage(
    owner,
    org,
    good,
    0,
    randomUUID(),
    async () => {},
    "companion",
  );
  const clean = vault.image(owner, org, state.staged!.id, true);
  expect(clean.toString()).not.toContain("PRIVATE FICTIONAL METADATA");
  expect((await sharp(clean).metadata()).comments).toBeUndefined();
  const hostile = Buffer.concat([
    image.subarray(0, 33),
    chunk("acTL", Buffer.alloc(8)),
    image.subarray(33),
  ]);
  const checked = await createLogoCompanion(hostile, {
    width: 128,
    height: 64,
    display: "square",
  });
  await expect(
    vault.stage(
      owner,
      org,
      checked,
      1,
      randomUUID(),
      async () => {},
      "companion",
    ),
  ).rejects.toMatchObject({ status: 422 });
  expect(vault.state(owner, org).staged).toEqual(state.staged);
  expect(vault.state(owner, org).remainingUploads).toBe(10);
});
it("shares upload and processing quotas across companion imports and refuses replay after failed intake", async () => {
  const { vault, owner, org } = setup(),
    bad = Buffer.from("not a zip"),
    id = randomUUID();
  await expect(
    vault.stage(owner, org, bad, 0, id, async () => {}, "companion"),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    vault.stage(owner, org, bad, 0, id, async () => {}, "companion"),
  ).rejects.toMatchObject({ status: 409 });
  for (let i = 0; i < 11; i++)
    await expect(
      vault.stage(
        owner,
        org,
        bad,
        0,
        randomUUID(),
        async () => {},
        "companion",
      ),
    ).rejects.toMatchObject({ status: 422 });
  const zip = await createLogoCompanion(await logoFixture(), {
    width: 128,
    height: 64,
    display: "square",
  });
  await expect(
    vault.stage(owner, org, zip, 0, randomUUID(), async () => {}, "companion"),
  ).rejects.toMatchObject({ status: 429 });
  expect(vault.state(owner, org)).toMatchObject({
    revision: 0,
    remainingUploads: 0,
    selected: null,
    staged: null,
  });
});
it("serializes competing imports and exports and refuses lost authority or expiry after asynchronous export", async () => {
  const { vault, owner, org } = setup(),
    bytes = await logoFixture();
  const staged = await vault.stage(
    owner,
    org,
    bytes,
    0,
    randomUUID(),
    async () => {},
  );
  const selected = vault.command(owner, org, {
    action: "select",
    assetId: staged.staged!.id,
    revision: 1,
    operationId: randomUUID(),
  });
  const zip = await vault.saveSelected(
    owner,
    org,
    selected.selected!.id,
    2,
    "companion",
    async () => {},
  );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    arrival = new Promise<void>((r) => (entered = r));
  const pending = vault.saveSelected(
    owner,
    org,
    selected.selected!.id,
    2,
    "companion",
    async () => {
      entered();
      await gate;
    },
  );
  await arrival;
  await expect(
    vault.stage(owner, org, zip, 2, randomUUID(), async () => {}, "companion"),
  ).rejects.toMatchObject({ status: 423 });
  expect(() =>
    vault.command(owner, org, {
      action: "remove",
      assetId: selected.selected!.id,
      revision: 2,
      operationId: randomUUID(),
    }),
  ).toThrow(/busy/);
  const secondOwner = { expiresAt: owner.expiresAt },
    otherOrg = randomUUID();
  const concurrent = vault.stage(
    secondOwner,
    otherOrg,
    zip,
    0,
    randomUUID(),
    async () => gate,
    "companion",
  );
  await expect(
    vault.stage(
      secondOwner,
      otherOrg,
      zip,
      0,
      randomUUID(),
      async () => {},
      "companion",
    ),
  ).rejects.toMatchObject({ status: 423 });
  await expect(
    vault.stage(
      { expiresAt: owner.expiresAt },
      randomUUID(),
      zip,
      0,
      randomUUID(),
      async () => {},
      "companion",
    ),
  ).rejects.toMatchObject({ status: 429 });
  release();
  await pending;
  await concurrent;
  await expect(
    vault.saveSelected(
      owner,
      org,
      selected.selected!.id,
      2,
      "png",
      async () => {
        throw new Error("Authority revoked");
      },
    ),
  ).rejects.toThrow(/revoked/);
  expect(vault.state(owner, org)).toEqual(selected);
  await expect(
    vault.saveSelected(
      owner,
      org,
      selected.selected!.id,
      2,
      "companion",
      async () => {
        owner.expiresAt = Date.now() - 1;
      },
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(() => vault.state(owner, org)).toThrow(/ended/);
});
it("invalidates an export if staged cleanup changes the observed revision and expires imported custody", async () => {
  const { vault, owner, org } = setup(),
    zip = await createLogoCompanion(await logoFixture(), {
      width: 128,
      height: 64,
      display: "square",
    });
  const staged = await vault.stage(
    owner,
    org,
    zip,
    0,
    randomUUID(),
    async () => {},
    "companion",
  );
  const selected = vault.command(owner, org, {
    action: "select",
    assetId: staged.staged!.id,
    revision: 1,
    operationId: randomUUID(),
  });
  const another = await vault.stage(
    owner,
    org,
    zip,
    2,
    randomUUID(),
    async () => {},
    "companion",
  );
  const now = Date.now();
  await expect(
    vault.saveSelected(
      owner,
      org,
      selected.selected!.id,
      3,
      "png",
      async () => {
        vi.spyOn(Date, "now").mockReturnValue(now + 600001);
        vault.sweep();
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(vault.state(owner, org).staged).toBeNull();
  expect(() => vault.image(owner, org, another.staged!.id, true)).toThrow(
    /unavailable/,
  );
  expect(vault.state(owner, org).selected!.id).toBe(selected.selected!.id);
});
