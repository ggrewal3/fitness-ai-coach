// Runs the backend test suite against a separate test database.
//
// Usage: TEST_DATABASE_URL=<connection string> npm test
//
// The test connection string is only ever read from the environment. It must
// not be committed or added to .env. The run refuses to start if it is missing
// or points at the same database as the development DATABASE_URL.
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error(
    "TEST_DATABASE_URL is not set. Point it at a dedicated test database (e.g. fitness_ai_test)."
  );
  process.exit(1);
}

function databaseIdentity(connectionString) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return null;
  }
}

// Read the development DATABASE_URL from .env without loading it into this
// process's environment, and never print either connection string.
const developmentEnv = {};
dotenv.config({ processEnv: developmentEnv, quiet: true });

const testIdentity = databaseIdentity(testDatabaseUrl);
const developmentUrls = [process.env.DATABASE_URL, developmentEnv.DATABASE_URL];

if (!testIdentity) {
  console.error("TEST_DATABASE_URL is not a valid connection string.");
  process.exit(1);
}

if (developmentUrls.some((url) => url && databaseIdentity(url) === testIdentity)) {
  console.error(
    "Refusing to run: TEST_DATABASE_URL points at the development database."
  );
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: testDatabaseUrl };

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Bring the test database to the current schema and built-in catalogue.
run("npx", ["prisma", "migrate", "deploy"]);
run("npx", ["prisma", "db", "seed"]);

// Test files run one at a time because they share one database.
run(process.execPath, [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=1",
  ...(process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["test/**/*.test.ts"]),
]);
