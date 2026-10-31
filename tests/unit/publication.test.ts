import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID, sign } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  chmod,
  symlink,
  cp,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { CheckpointPublisher } from "../../src/server/publication/store";
import {
  checkpointDigest,
  type Journal,
} from "../../src/server/lineage/protocol";
import {
  receiptDigest,
  publicationApprovalMessage,
  type Publication,
} from "../../src/server/publication/protocol";
import { digest } from "../../src/server/recovery/trust";
import { custodians } from "../helpers/lineage";
import { publicationJournal, signPublication } from "../helpers/publication";
let dir: string,
  directory: string,
  trustFile: string,
  rootDigest: string,
  publisher: CheckpointPublisher,
  journal: Journal;
const authority = custodians();
const publishInput = (publication: Publication) => ({
  publication,
  confirmation: "PUBLISH VERIFIED FICTIONAL CHECKPOINT",
});
const verifyInput = (minimumReceiptDigest: string) => ({
  minimumReceiptDigest,
  confirmation: "VERIFY PUBLISHED FICTIONAL CHECKPOINT",
});
const resumeInput = (expectedPublicationDigest: string) => ({
  expectedPublicationDigest,
  confirmation: "RESUME THE EXACT APPROVED PUBLICATION",
});
function options() {
  return { directory, trustFile, expectedRootDigest: rootDigest };
}
async function approved(
  j = journal,
  parent: string | null = null,
  service = publisher,
) {
  return signPublication(
    authority,
    await service.review(j, {
      expectedReceiptDigest: parent,
      confirmation: "REVIEW FICTIONAL CHECKPOINT PUBLICATION",
    }),
  );
}
class Interrupted extends CheckpointPublisher {
  constructor(private readonly stopAt: string) {
    super(options());
  }
  protected override async afterDurabilityStep(step: string) {
    if (step === this.stopAt)
      throw new Error("Synthetic interruption at " + step);
  }
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lms-publication-"));
  directory = path.join(dir, "custody");
  trustFile = path.join(dir, "trust.json");
  await writeFile(trustFile, JSON.stringify(authority.registry), {
    mode: 0o600,
  });
  journal = publicationJournal(authority);
  const root = await new CheckpointPublisher({
    directory,
    trustFile,
  }).initialize(journal, {
    expectedCheckpointDigest: checkpointDigest(journal.checkpoints.at(-1)!),
    confirmation: "INITIALIZE FICTIONAL PUBLICATION CUSTODY",
  });
  rootDigest = root.rootDigest;
  publisher = new CheckpointPublisher(options());
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});
it("publishes only after independent signed approval and explicit confirmation, then verifies a portable receipt", async () => {
  const p = await approved();
  await expect(
    publisher.publish(journal, { ...publishInput(p), force: true }),
  ).rejects.toThrow();
  const bad = structuredClone(p);
  bad.approval.signature = Buffer.alloc(64).toString("base64");
  await expect(
    publisher.publish(journal, publishInput(bad)),
  ).rejects.toMatchObject({ status: 403 });
  const result = await publisher.publish(journal, publishInput(p));
  expect(result).toMatchObject({
    receiptDigest: receiptDigest(p),
    activationAllowed: false,
  });
  expect(
    await publisher.verify(verifyInput(result.receiptDigest)),
  ).toMatchObject({
    journal,
    checkpointDigest: checkpointDigest(journal.checkpoints.at(-1)!),
    activationAllowed: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /password|material|session|secret|privateKey/,
  );
  await expect(
    publisher.publish(journal, publishInput(p)),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects one-person publication and checkpoint signatures reused as publication approvals", async () => {
  const p = await approved(),
    single = structuredClone(p),
    id = p.verification.operatorId;
  single.approval = {
    operatorId: id,
    signature: sign(
      null,
      Buffer.from(publicationApprovalMessage(p.request, p.verification, id)),
      authority.keys[0].privateKey,
    ).toString("base64"),
  };
  await expect(
    publisher.publish(journal, publishInput(single)),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    publisher.publish(
      journal,
      publishInput({
        ...p,
        verification: journal.checkpoints[0].verification,
        approval: journal.checkpoints[0].approval,
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it("serializes competing approvals across separate handles and refuses a stale compare-and-swap parent", async () => {
  const a = await approved(),
    b = await approved();
  const results = await Promise.allSettled([
    publisher.publish(journal, publishInput(a)),
    new CheckpointPublisher(options()).publish(journal, publishInput(b)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect([409, 423]).toContain(
    results.find((r) => r.status === "rejected")?.reason.status,
  );
  const winner = results.find((r) => r.status === "fulfilled")!.value;
  expect(
    (await publisher.verify(verifyInput(winner.receiptDigest))).receiptDigest,
  ).toBe(winner.receiptDigest);
  await expect(
    approved(publicationJournal(authority, journal), null),
  ).rejects.toMatchObject({ status: 409 });
});
it("appends the exact next checkpoint and detects old-store rollback against independent receipt custody", async () => {
  const first = await publisher.publish(
    journal,
    publishInput(await approved()),
  );
  await cp(directory, path.join(dir, "older-store"), { recursive: true });
  const next = publicationJournal(authority, journal),
    p = await approved(next, first.receiptDigest);
  const second = await publisher.publish(next, publishInput(p));
  expect(
    (await publisher.verify(verifyInput(first.receiptDigest))).receiptDigest,
  ).toBe(second.receiptDigest);
  const rolledBack = new CheckpointPublisher({
    ...options(),
    directory: path.join(dir, "older-store"),
  });
  await expect(
    rolledBack.verify(verifyInput(second.receiptDigest)),
  ).rejects.toThrow(/rollback|fork/);
  await rm(path.join(directory, "001.json"));
  await expect(
    publisher.verify(verifyInput(second.receiptDigest)),
  ).rejects.toThrow(/missing|order/);
});
it("refuses altered history, skipped epochs, changed commitments and unsupported instance transitions", async () => {
  const first = await publisher.publish(
    journal,
    publishInput(await approved()),
  );
  const next = publicationJournal(authority, journal);
  for (const changed of [
    publicationJournal(authority, next),
    publicationJournal(authority, journal, {
      capturedInstanceId: randomUUID(),
    }),
    publicationJournal(authority, journal, {
      credentialCommitment: digest("changed silently"),
    }),
  ])
    await expect(approved(changed, first.receiptDigest)).rejects.toThrow();
  const altered = structuredClone(next);
  altered.checkpoints[0].checkpoint.credentialCommitment =
    digest("altered baseline");
  altered.checkpoints[0] = authority.seal(altered.checkpoints[0].checkpoint);
  altered.checkpoints[1] = authority.seal({
    ...altered.checkpoints[1].checkpoint,
    previousCheckpointDigest: checkpointDigest(altered.checkpoints[0]),
  });
  await expect(approved(altered, first.receiptDigest)).rejects.toThrow(
    /altered|conflict/,
  );
});
it("refuses future/expired reviews and refuses an expired checkpoint as current evidence", async () => {
  const p = await approved();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 300001);
  await expect(
    publisher.publish(journal, publishInput(p)),
  ).rejects.toMatchObject({ status: 410 });
  vi.useRealTimers();
  const future = signPublication(authority, {
    ...p.request,
    createdAt: new Date(Date.now() + 1000).toISOString(),
  });
  await expect(
    publisher.publish(journal, publishInput(future)),
  ).rejects.toMatchObject({ status: 403 });
  const first = await publisher.publish(journal, publishInput(p));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 600001);
  await expect(
    publisher.verify(verifyInput(first.receiptDigest)),
  ).rejects.toMatchObject({ status: 410 });
  vi.useRealTimers();
});
it.each([
  "intent-synced",
  "intent-directory-synced",
  "record-synced",
  "record-directory-synced",
])(
  "resumes the exact unexpired signed intent after interruption at %s without accepting an older head",
  async (step) => {
    const p = await approved(),
      service = new Interrupted(step);
    await expect(service.publish(journal, publishInput(p))).rejects.toThrow(
      /Synthetic interruption/,
    );
    await expect(
      publisher.verify(verifyInput(receiptDigest(p))),
    ).rejects.toMatchObject({ status: 423 });
    await expect(
      publisher.resume(resumeInput(digest("wrong receipt"))),
    ).rejects.toMatchObject({ status: 403 });
    expect(await publisher.resume(resumeInput(receiptDigest(p)))).toMatchObject(
      { receiptDigest: receiptDigest(p), activationAllowed: false },
    );
    expect(
      (await publisher.verify(verifyInput(receiptDigest(p)))).receiptDigest,
    ).toBe(receiptDigest(p));
  },
);
it.each(["pending-removed", "completion-directory-synced"])(
  "reconciles a lost response at %s using the independently retained receipt",
  async (step) => {
    const p = await approved();
    await expect(
      new Interrupted(step).publish(journal, publishInput(p)),
    ).rejects.toThrow(/Synthetic interruption/);
    expect(
      (await publisher.verify(verifyInput(receiptDigest(p)))).receiptDigest,
    ).toBe(receiptDigest(p));
    await expect(
      publisher.publish(journal, publishInput(p)),
    ).rejects.toMatchObject({ status: 409 });
  },
);
it("completes only an exact partial-record prefix and refuses corrupted or partial intent evidence", async () => {
  const p = await approved();
  await expect(
    new Interrupted("intent-directory-synced").publish(
      journal,
      publishInput(p),
    ),
  ).rejects.toThrow();
  const intent = await readFile(path.join(directory, "pending.json"), "utf8");
  await writeFile(path.join(directory, "001.json"), intent.slice(0, 41), {
    mode: 0o600,
  });
  expect(
    (await publisher.resume(resumeInput(receiptDigest(p)))).receiptDigest,
  ).toBe(receiptDigest(p));
  const next = publicationJournal(authority, journal),
    n = await approved(next, receiptDigest(p));
  await expect(
    new Interrupted("intent-directory-synced").publish(next, publishInput(n)),
  ).rejects.toThrow();
  const full = await readFile(path.join(directory, "pending.json"), "utf8");
  await writeFile(path.join(directory, "pending.json"), full.slice(0, 31));
  await expect(
    publisher.resume(resumeInput(receiptDigest(n))),
  ).rejects.toThrow();
  await expect(
    publisher.verify(verifyInput(receiptDigest(p))),
  ).rejects.toMatchObject({ status: 423 });
});
it("refuses expired interrupted approval and conflicting partial data while retaining quarantine", async () => {
  const p = await approved();
  await expect(
    new Interrupted("intent-directory-synced").publish(
      journal,
      publishInput(p),
    ),
  ).rejects.toThrow();
  await writeFile(path.join(directory, "001.json"), "different bytes", {
    mode: 0o600,
  });
  await expect(publisher.resume(resumeInput(receiptDigest(p)))).rejects.toThrow(
    /Conflicting/,
  );
  await rm(path.join(directory, "001.json"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 300001);
  await expect(
    publisher.resume(resumeInput(receiptDigest(p))),
  ).rejects.toMatchObject({ status: 410 });
  await expect(
    publisher.verify(verifyInput(receiptDigest(p))),
  ).rejects.toMatchObject({ status: 423 });
});
it("rejects missing roots, root substitution, insecure files, symlinks and unknown files without reinitialization", async () => {
  const original = await readFile(path.join(directory, "root.json"), "utf8");
  await writeFile(
    path.join(directory, "root.json"),
    JSON.stringify({ ...JSON.parse(original), id: randomUUID() }),
  );
  await expect(approved()).rejects.toMatchObject({ status: 403 });
  await writeFile(path.join(directory, "root.json"), original);
  await chmod(path.join(directory, "root.json"), 0o644);
  await expect(approved()).rejects.toThrow();
  await chmod(path.join(directory, "root.json"), 0o600);
  await writeFile(path.join(directory, "unknown"), "incomplete", {
    mode: 0o600,
  });
  await expect(approved()).rejects.toThrow(/Unknown/);
  await rm(path.join(directory, "unknown"));
  const linked = path.join(dir, "symlink");
  await symlink(directory, linked);
  await expect(
    approved(
      journal,
      null,
      new CheckpointPublisher({ ...options(), directory: linked }),
    ),
  ).rejects.toThrow();
  await expect(
    publisher.initialize(journal, {
      expectedCheckpointDigest: checkpointDigest(journal.checkpoints[0]),
      confirmation: "INITIALIZE FICTIONAL PUBLICATION CUSTODY",
    }),
  ).rejects.toThrow();
  await rm(path.join(directory, "root.json"));
  await expect(approved()).rejects.toThrow();
});
it("releases the kernel lock after SIGKILL and safely resumes durable intent in a new process", async () => {
  const p = await approved();
  const script = `import fs from 'node:fs';import {CheckpointPublisher} from ${JSON.stringify(path.join(process.cwd(), "src/server/publication/store.ts"))};class Crash extends CheckpointPublisher{async afterDurabilityStep(s){if(s==='intent-directory-synced')process.kill(process.pid,'SIGKILL');}}const v=JSON.parse(fs.readFileSync(0,'utf8'));await new Crash(v.options).publish(v.journal,v.input);`;
  const result = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
    child.stdin.end(
      JSON.stringify({ options: options(), journal, input: publishInput(p) }),
    );
  });
  expect(result.signal).toBe("SIGKILL");
  await expect(
    publisher.verify(verifyInput(receiptDigest(p))),
  ).rejects.toMatchObject({ status: 423 });
  expect(
    (await publisher.resume(resumeInput(receiptDigest(p)))).receiptDigest,
  ).toBe(receiptDigest(p));
});

it("runs the offline CLI with protected paths, validates input and never prints submitted secrets", async () => {
  const publication = await approved();
  await publisher.publish(journal, publishInput(publication));
  const run = (action: string, input: unknown) =>
    new Promise<{ code: number | null; out: string; err: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import=tsx", "scripts/checkpoint-publication.ts", action],
          {
            env: {
              ...process.env,
              LMS_PUBLICATION_DIRECTORY: directory,
              LMS_RECOVERY_TRUST_FILE: trustFile,
              LMS_PUBLICATION_ROOT_DIGEST: rootDigest,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (v) => (out += v));
        child.stderr.on("data", (v) => (err += v));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(JSON.stringify(input));
      },
    );
  const result = await run("verify", verifyInput(receiptDigest(publication)));
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out)).toMatchObject({
    activationAllowed: false,
    receiptDigest: receiptDigest(publication),
  });
  const secret = "fictional_submitted_secret_not_logged";
  const failed = await run("verify", {
    ...verifyInput(receiptDigest(publication)),
    password: secret,
  });
  expect(failed.code).toBe(1);
  expect(failed.out + failed.err).not.toContain(secret);
  expect((await run("force-unblock", {})).code).toBe(1);
});

it('refuses reuse of a publication identifier even with newly signed checkpoint and approval contexts',async()=>{
 const old=await approved();const first=await publisher.publish(journal,publishInput(old));
 const next=publicationJournal(authority,journal);const request=(await approved(next,first.receiptDigest)).request;
 const replay=signPublication(authority,{...request,publicationId:old.request.publicationId});
 await expect(publisher.publish(next,publishInput(replay))).rejects.toMatchObject({status:409});
 expect((await publisher.verify(verifyInput(first.receiptDigest))).receiptDigest).toBe(first.receiptDigest);
});
