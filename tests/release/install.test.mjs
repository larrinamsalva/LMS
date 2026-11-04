import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const launcher = fileURLToPath(
  new URL("../../scripts/start-demo.mjs", import.meta.url),
);

test("launcher rejects unsafe arguments, missing builds and environment files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lms-demo-install-"));
  const copied = join(dir, "scripts", "start-demo.mjs");
  const secret = "fictional-secret-for-install-test";
  try {
    await mkdir(join(dir, "scripts"));
    await cp(launcher, copied);
    const cases = [
      [["--hostname", "0.0.0.0"], /Usage:/],
      [["--port", "65536"], /Choose a port/],
      [[], /npm ci and npm run build/],
    ];
    for (const [args, message] of cases) {
      const result = spawnSync(process.execPath, [copied, ...args], {
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    }
    await writeFile(
      join(dir, ".env.production.local"),
      `DATABASE_URL=${secret}\n`,
    );
    const refused = spawnSync(process.execPath, [copied], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /clean LMS checkout/);
    assert.ok(!(refused.stdout + refused.stderr).includes(secret));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "built demo serves both businesses on loopback and discards data on restart",
  { timeout: 90_000 },
  async () => {
    const listener = createServer().listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address();
    try {
      const occupied = spawnSync(
        process.execPath,
        [launcher, "--port", String(port)],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.equal(occupied.status, 1);
      assert.match(occupied.stderr, /Port [0-9]+ is already in use/);
    } finally {
      await new Promise((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
    const origin = `http://127.0.0.1:${port}`;
    const secret = "fictional-unused-database-secret";
    let connectionAttempts = 0;
    const databaseProbe = createServer((socket) => {
      connectionAttempts++;
      socket.destroy();
    }).listen(0, "127.0.0.1");
    await once(databaseProbe, "listening");
    const databaseUrl = `postgresql://lms:${secret}@127.0.0.1:${databaseProbe.address().port}/unused`;
    let server;
    let log = "";
    async function start() {
      server = spawn(process.execPath, [launcher, "--port", String(port)], {
        env: {
          ...process.env,
          LMS_APP_ORIGIN: "https://wrong-origin.invalid",
          LMS_POSTGRES_URL: databaseUrl,
          LMS_ADMIN_DATABASE_URL: databaseUrl,
          LMS_AUTH_DATABASE_URL: databaseUrl,
          DATABASE_URL: databaseUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const stream of [server.stdout, server.stderr]) {
        stream.on("data", (chunk) => {
          log += chunk.toString();
        });
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null) break;
        try {
          const home = await fetch(origin, {
            signal: AbortSignal.timeout(500),
          });
          if (home.ok) {
            const html = await home.text();
            assert.match(html, /Explore the working demo/);
            assert.ok(!html.includes(secret));
            return;
          }
        } catch (error) {
          if (error instanceof assert.AssertionError) throw error;
        }
        await delay(100);
      }
      assert.fail(
        "Built demo did not start. Check the build and whether the port is occupied.",
      );
    }
    async function stop() {
      if (!server || server.exitCode !== null || server.signalCode !== null)
        return;
      const exited = once(server, "exit");
      const escalation = setTimeout(() => server.kill("SIGKILL"), 4000);
      try {
        server.kill("SIGTERM");
        await exited;
      } finally {
        clearTimeout(escalation);
      }
    }
    const get = (path, cookie) =>
      fetch(origin + path, {
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(10_000),
      });
    const post = (data, cookie, requestOrigin = origin) =>
      fetch(origin + "/api/demo", {
        method: "POST",
        headers: {
          Origin: requestOrigin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(15_000),
      });
    try {
      await start();
      assert.equal((await get("/api/local-auth/get-session")).status, 404);
      assert.equal((await get("/api/demo")).status, 401);
      assert.equal(
        (
          await post(
            { action: "start" },
            undefined,
            "https://wrong-origin.invalid",
          )
        ).status,
        403,
      );
      const created = await post({ action: "start" });
      assert.equal(created.status, 200);
      const setCookie = created.headers.get("set-cookie");
      assert.ok(setCookie, "Demo must issue a session cookie.");
      const [cookie, ...attributes] = setCookie.split(";");
      const policy = attributes.join(";");
      assert.match(policy, /Max-Age=7200/i);
      assert.match(policy, /HttpOnly/i);
      assert.match(policy, /SameSite=strict/i);
      const { session, workspace } = await created.json();
      assert.deepEqual(
        session.organizations.map(({ industry }) => industry),
        ["property", "cleaning"],
      );
      assert.ok(Math.abs(session.expiresAt - Date.now() - 7_200_000) < 10_000);
      const [property, cleaning] = session.organizations;
      const invalid = await post(
        {
          action: "configure",
          organizationId: property.id,
          document: {},
          revision: 1,
        },
        cookie,
      );
      assert.equal(invalid.status, 400);
      const rejected = await invalid.text();
      assert.ok(!rejected.includes(secret));
      const name = "Fictional restart marker";
      const saved = await post(
        {
          action: "save",
          organizationId: property.id,
          entity: "customers",
          data: { name },
        },
        cookie,
      );
      assert.equal(saved.status, 200);
      assert.equal(
        (await saved.json()).workspace.config.revision,
        workspace.config.revision,
      );
      const propertyRead = await (await get("/api/demo", cookie)).json();
      assert.ok(
        propertyRead.workspace.records.some(({ data }) => data.name === name),
      );
      const cleaningRead = await (
        await get(`/api/demo?organizationId=${cleaning.id}`, cookie)
      ).json();
      assert.ok(
        cleaningRead.workspace.records.every(({ data }) => data.name !== name),
      );
      const other = await post({ action: "start" });
      assert.equal(other.status, 200);
      const otherCookie = other.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (await get(`/api/demo?organizationId=${property.id}`, otherCookie))
          .status,
        403,
      );
      await stop();
      await start();
      assert.equal((await get("/api/demo", cookie)).status, 401);
      const fresh = await post({ action: "start" });
      assert.equal(fresh.status, 200);
      const reopened = await fresh.json();
      assert.notEqual(reopened.workspace.organizationId, property.id);
      assert.ok(
        reopened.workspace.records.every(({ data }) => data.name !== name),
      );
      assert.ok(!JSON.stringify(reopened).includes(secret));
      await stop();
      // Successful exclusive rebinding verifies that the last server released its socket.
      const rebound = createServer().listen({
        port,
        host: "127.0.0.1",
        exclusive: true,
      });
      await once(rebound, "listening");
      await new Promise((resolve) => rebound.close(resolve));
      assert.equal(
        connectionAttempts,
        0,
        "Demo attempted to open a persistent database connection.",
      );
      assert.ok(!log.includes(secret));
    } finally {
      try {
        await stop();
      } finally {
        await new Promise((resolve) => databaseProbe.close(resolve));
      }
    }
  },
);
