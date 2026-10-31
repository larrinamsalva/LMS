import { createLocalAuth } from "../../src/server/auth/host";
const [databaseName] = process.argv.slice(2);
let cookie = "";
for await (const chunk of process.stdin) {
  cookie += chunk;
  if (cookie.length > 8192) throw new Error("Cookie input too large");
}
const host = await createLocalAuth({
  databaseUrl: process.env.LMS_TEST_AUTH_URL!,
  databaseName,
  origin: process.env.LMS_TEST_AUTH_ORIGIN!,
  secret: process.env.LMS_TEST_AUTH_SECRET!,
});
try {
  console.log(JSON.stringify(await host.principal(new Headers({ cookie }))));
} finally {
  await host.close();
}
