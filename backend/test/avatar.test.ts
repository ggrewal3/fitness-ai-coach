import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { after, before, beforeEach, describe, it } from "node:test";
import sharp from "sharp";
import { setObjectStorage } from "../src/lib/storage/index.js";
import { LocalObjectStorage } from "../src/lib/storage/localObjectStorage.js";
import { sweepOrphanAvatars } from "../src/lib/storage/orphanSweep.js";
import { signMediaKeyWithExpiry } from "../src/lib/storage/signedMediaUrl.js";
import {
  createApi,
  createTestUser,
  deleteTestUsers,
  prisma,
  startTestServer,
  type Api,
  type TestServer,
  type TestUser,
} from "./helpers.js";

// Profile photo backend (ADR-024). Storage is an isolated temp directory, never
// backend/storage. All images are generated in memory.

/** Local storage with failure injection for the replacement/deletion paths. */
class TestStorage extends LocalObjectStorage {
  failPut = false;
  failDelete = false;
  afterPut: (() => Promise<void>) | null = null;

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPut) {
      throw new Error("injected put failure");
    }

    await super.put(key, body, contentType);

    if (this.afterPut) {
      await this.afterPut();
    }
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) {
      throw new Error("injected delete failure");
    }

    await super.delete(key);
  }
}

let server: TestServer;
let api: Api;
let storageRoot: string;
let storage: TestStorage;
const createdUserIds: number[] = [];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AVATAR_URL_PATTERN = new RegExp(`^/api/media/avatars/${UUID}\\.webp\\?expires=\\d+&signature=[A-Za-z0-9_-]{43}$`);

before(async () => {
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "fitai-avatar-test-"));
  storage = new TestStorage(storageRoot);
  setObjectStorage(storage);
  server = await startTestServer();
  api = createApi(server.baseUrl);
});

beforeEach(() => {
  storage.failPut = false;
  storage.failDelete = false;
  storage.afterPut = null;
});

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
  await prisma.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

// ---------- helpers ----------

type RawResponse = { status: number; body: any; headers: Headers; bytes: Buffer };

async function raw(method: string, urlPath: string, options: { token?: string; body?: Buffer; type?: string } = {}): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.type) headers["Content-Type"] = options.type;

  const response = await fetch(`${server.baseUrl}${urlPath}`, { method, headers, body: options.body ? new Uint8Array(options.body) : undefined });
  const bytes = Buffer.from(await response.arrayBuffer());
  const isJson = response.headers.get("content-type")?.includes("application/json");

  return { status: response.status, body: isJson && bytes.length ? JSON.parse(bytes.toString()) : null, headers: response.headers, bytes };
}

const upload = (user: TestUser, body: Buffer, type = "image/jpeg") =>
  raw("PUT", "/api/account/avatar", { token: user.token, body, type });

const removeAvatar = (user: TestUser) => raw("DELETE", "/api/account/avatar", { token: user.token });

function solid(width: number, height: number, background = "#3b82f6") {
  return sharp({ create: { width, height, channels: 3, background } });
}

const jpeg = (w = 640, h = 480) => solid(w, h).jpeg().toBuffer();
const png = (w = 640, h = 480) => solid(w, h, "#16a34a").png().toBuffer();
const webp = (w = 640, h = 480) => solid(w, h, "#f59e0b").webp().toBuffer();

/** A PNG whose header claims the given size but contains no pixel data. */
function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}

async function storedFiles(): Promise<string[]> {
  try {
    return (await readdir(path.join(storageRoot, "avatars"))).sort();
  } catch {
    return [];
  }
}

async function avatarKeyOf(user: TestUser): Promise<string | null> {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarKey: true } });
  return row?.avatarKey ?? null;
}

const keyFromUrl = (url: string) => url.slice("/api/media/".length).split("?")[0];
const fileOf = (key: string) => path.join(storageRoot, key);

async function pixel(image: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

const isReddish = ([r, g, b]: number[]) => r > 180 && g < 80 && b < 80;
const isBluish = ([r, g, b]: number[]) => b > 180 && r < 80 && g < 80;
const isGreenish = ([r, g, b]: number[]) => g > 100 && r < 80 && b < 80;

// ---------- upload ----------

describe("PUT /api/account/avatar: accepted uploads", () => {
  for (const [label, make, type] of [
    ["JPEG", jpeg, "image/jpeg"],
    ["PNG", png, "image/png"],
    ["WebP", webp, "image/webp"],
  ] as const) {
    it(`accepts ${label} and stores a 512×512 WebP`, async () => {
      const user = await createTestUser(api, createdUserIds);
      const response = await upload(user, await make(), type);

      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.match(response.body.avatarUrl, AVATAR_URL_PATTERN);
      assert.equal(response.body.email, user.email);
      assert.ok(!("avatarKey" in response.body));

      const key = await avatarKeyOf(user);
      assert.equal(key, keyFromUrl(response.body.avatarUrl));

      const stored = await readFile(fileOf(key!));
      const metadata = await sharp(stored).metadata();
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);
    });
  }

  it("strips EXIF (including GPS), ICC and XMP metadata", async () => {
    const user = await createTestUser(api, createdUserIds);
    const tagged = await solid(800, 600)
      .withExif({ IFD0: { Copyright: "fitai-test", Artist: "someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .withIccProfile("p3")
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
      .jpeg()
      .toBuffer();
    const input = await sharp(tagged).metadata();
    assert.ok(input.exif && input.icc && input.xmp, "fixture carries metadata");
    assert.ok(input.exif.includes(Buffer.from([0x88, 0x25])) || input.exif.includes(Buffer.from([0x25, 0x88])), "fixture has a GPS IFD");

    const response = await upload(user, tagged);
    assert.equal(response.status, 200);

    const output = await sharp(await readFile(fileOf((await avatarKeyOf(user))!))).metadata();
    assert.equal(output.exif, undefined);
    assert.equal(output.icc, undefined);
    assert.equal(output.xmp, undefined);
    assert.equal(output.iptc, undefined);
    assert.equal(output.orientation, undefined);
  });

  it("applies EXIF orientation before cropping", async () => {
    const user = await createTestUser(api, createdUserIds);
    // Stored 300×150: left half red, right half blue. Orientation 6 means
    // "rotate 90° clockwise to display", so displayed it is 150×300 with red on top.
    const base = await solid(300, 150, "#ff0000")
      .composite([{ input: { create: { width: 150, height: 150, channels: 3, background: "#0000ff" } }, left: 150, top: 0 }])
      .png()
      .toBuffer();
    const rotated = await sharp(base).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    assert.equal((await sharp(rotated).metadata()).orientation, 6);

    const response = await upload(user, rotated);
    assert.equal(response.status, 200);

    const stored = await readFile(fileOf((await avatarKeyOf(user))!));
    assert.ok(isReddish(await pixel(stored, 256, 60)), "top is red after orientation");
    assert.ok(isBluish(await pixel(stored, 256, 450)), "bottom is blue after orientation");
  });

  it("centre-crops non-square images (the documented crop strategy)", async () => {
    const user = await createTestUser(api, createdUserIds);
    // 900×300 thirds: red | green | blue. A centre crop keeps the middle third.
    const striped = await solid(900, 300, "#ff0000")
      .composite([
        { input: { create: { width: 300, height: 300, channels: 3, background: "#00a000" } }, left: 300, top: 0 },
        { input: { create: { width: 300, height: 300, channels: 3, background: "#0000ff" } }, left: 600, top: 0 },
      ])
      .png()
      .toBuffer();

    const response = await upload(user, striped, "image/png");
    assert.equal(response.status, 200);

    const stored = await readFile(fileOf((await avatarKeyOf(user))!));
    for (const x of [10, 256, 500]) {
      assert.ok(isGreenish(await pixel(stored, x, 256)), `pixel x=${x} comes from the centre third`);
    }
  });
});

describe("PUT /api/account/avatar: rejected uploads", () => {
  it("rejects malformed and disguised files with 400, changing nothing", async () => {
    const user = await createTestUser(api, createdUserIds);
    const before = await storedFiles();
    const realJpeg = await jpeg(800, 600);

    for (const [label, body, type] of [
      ["random bytes as JPEG", Buffer.from(randomUUID().repeat(40)), "image/jpeg"],
      ["PNG declared as JPEG", await png(), "image/jpeg"],
      ["JPEG declared as WebP", realJpeg, "image/webp"],
      ["HTML declared as PNG", Buffer.from("<html><script>alert(1)</script></html>"), "image/png"],
      ["SVG declared as PNG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"],
      ["truncated JPEG", realJpeg.subarray(0, Math.floor(realJpeg.length / 2)), "image/jpeg"],
      ["empty body", Buffer.alloc(0), "image/jpeg"],
    ] as const) {
      const response = await upload(user, body, type);
      assert.equal(response.status, 400, `${label}: ${JSON.stringify(response.body)}`);
      assert.equal(typeof response.body.message, "string");
      assert.ok(!/storage|\/|\\|sharp|vips/i.test(response.body.message), `${label}: message leaks internals`);
    }

    assert.equal(await avatarKeyOf(user), null);
    assert.deepEqual(await storedFiles(), before);
  });

  it("rejects unsupported media types with 415", async () => {
    const user = await createTestUser(api, createdUserIds);
    const gif = await solid(10, 10).gif().toBuffer();

    for (const [body, type] of [
      [gif, "image/gif"],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
      [await jpeg(), "application/octet-stream"],
      // Valid JSON is not an image. (Malformed JSON is rejected earlier with
      // 400 by the app-wide express.json() parser, as on every route.)
      [Buffer.from(JSON.stringify({ image: "data:image/png;base64,AAAA" })), "application/json"],
    ] as const) {
      const response = await upload(user, body, type);
      assert.equal(response.status, 415, type);
    }

    const noType = await raw("PUT", "/api/account/avatar", { token: user.token, body: await jpeg() });
    assert.equal(noType.status, 415);
    assert.equal(await avatarKeyOf(user), null);
  });

  it("rejects bodies over 5 MB with 413", async () => {
    const user = await createTestUser(api, createdUserIds);
    const response = await upload(user, Buffer.alloc(5 * 1024 * 1024 + 1, 1), "image/png");

    assert.equal(response.status, 413);
    assert.equal(response.body.message, "Profile photos must be 5 MB or smaller.");
    assert.equal(await avatarKeyOf(user), null);
  });

  it("rejects excessive dimensions and pixel counts before decoding", async () => {
    const user = await createTestUser(api, createdUserIds);

    for (const [label, body] of [
      ["8001 px wide (real image)", await solid(8001, 4).png().toBuffer()],
      ["9000×9000 header-only bomb", pngHeaderOnly(9000, 9000)],
      ["7000×6000 = 42 MP header-only", pngHeaderOnly(7000, 6000)],
      ["60000×60000 header-only bomb", pngHeaderOnly(60000, 60000)],
    ] as const) {
      const response = await upload(user, body, "image/png");
      assert.equal(response.status, 400, label);
      assert.match(response.body.message, /8000 pixels|valid/, label);
    }

    assert.equal(await avatarKeyOf(user), null);
  });

  it("requires authentication for upload and delete", async () => {
    const body = await jpeg();
    assert.equal((await raw("PUT", "/api/account/avatar", { body, type: "image/jpeg" })).status, 401);
    assert.equal((await raw("PUT", "/api/account/avatar", { body, type: "image/jpeg", token: "not-a-token" })).status, 401);
    assert.equal((await raw("DELETE", "/api/account/avatar")).status, 401);
    assert.equal((await raw("DELETE", "/api/account/avatar", { token: "not-a-token" })).status, 401);
  });
});

// ---------- ownership ----------

describe("avatar ownership", () => {
  it("only ever changes the token's own avatar", async () => {
    const userA = await createTestUser(api, createdUserIds);
    const userB = await createTestUser(api, createdUserIds);
    assert.equal((await upload(userB, await png(), "image/png")).status, 200);
    const keyB = await avatarKeyOf(userB);

    // Query-string user ids are ignored; there is no per-user avatar route.
    const viaQuery = await raw("PUT", `/api/account/avatar?userId=${userB.id}`, { token: userA.token, body: await jpeg(), type: "image/jpeg" });
    assert.equal(viaQuery.status, 200);
    assert.notEqual(await avatarKeyOf(userA), null);
    assert.equal(await avatarKeyOf(userB), keyB);

    assert.equal((await raw("PUT", `/api/account/avatar/${userB.id}`, { token: userA.token, body: await jpeg(), type: "image/jpeg" })).status, 404);
    assert.equal((await raw("DELETE", `/api/account/avatar?userId=${userB.id}`, { token: userA.token })).status, 200);
    assert.equal(await avatarKeyOf(userA), null);
    assert.equal(await avatarKeyOf(userB), keyB, "B's avatar untouched by A's delete");
  });
});

// ---------- replacement ----------

describe("avatar replacement", () => {
  it("activates the new avatar and removes the previous object", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const firstKey = (await avatarKeyOf(user))!;

    const second = await upload(user, await png(), "image/png");
    assert.equal(second.status, 200);
    const secondKey = (await avatarKeyOf(user))!;

    assert.notEqual(secondKey, firstKey);
    assert.equal(keyFromUrl(second.body.avatarUrl), secondKey);
    assert.ok((await storedFiles()).includes(path.basename(secondKey)));
    assert.ok(!(await storedFiles()).includes(path.basename(firstKey)), "old object deleted");
  });

  it("keeps the old avatar when storing the new one fails (503)", async () => {
    const user = await createTestUser(api, createdUserIds);
    const first = await upload(user, await jpeg());
    const firstKey = (await avatarKeyOf(user))!;
    const before = await storedFiles();

    storage.failPut = true;
    const response = await upload(user, await png(), "image/png");

    assert.equal(response.status, 503);
    assert.ok(!/injected|storage path|\//.test(response.body.message));
    assert.equal(await avatarKeyOf(user), firstKey);
    assert.deepEqual(await storedFiles(), before);
    storage.failPut = false;
    assert.equal((await raw("GET", first.body.avatarUrl)).status, 200, "old avatar still served");
  });

  it("cleans up the new object when the database update fails, keeping the old avatar", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const firstKey = (await avatarKeyOf(user))!;
    const before = await storedFiles();

    const originalTransaction = prisma.$transaction;
    storage.afterPut = async () => {
      // Simulate the database failing right after the object reached storage.
      (prisma as any).$transaction = async () => {
        throw new Error("injected database failure");
      };
    };

    try {
      const response = await upload(user, await png(), "image/png");
      assert.equal(response.status, 500);
    } finally {
      (prisma as any).$transaction = originalTransaction;
    }

    assert.equal(await avatarKeyOf(user), firstKey);
    assert.deepEqual(await storedFiles(), before, "new object removed, old object kept");
  });

  it("cleans up the new object if the user disappears mid-upload (404)", async () => {
    const user = await createTestUser(api, createdUserIds);
    const before = await storedFiles();
    storage.afterPut = async () => {
      await prisma.user.delete({ where: { id: user.id } });
    };

    const response = await upload(user, await jpeg());
    assert.equal(response.status, 404);
    assert.deepEqual(await storedFiles(), before);
  });

  it("keeps the new avatar active when deleting the old object fails (old becomes an orphan)", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const firstKey = (await avatarKeyOf(user))!;

    storage.failDelete = true;
    const response = await upload(user, await png(), "image/png");
    storage.failDelete = false;

    assert.equal(response.status, 200);
    const activeKey = (await avatarKeyOf(user))!;
    assert.notEqual(activeKey, firstKey);
    assert.equal(keyFromUrl(response.body.avatarUrl), activeKey);
    assert.ok((await storedFiles()).includes(path.basename(firstKey)), "old object left behind as an orphan");

    const sweep = await sweepOrphanAvatars({
      storage,
      referencedKeys: new Set([activeKey]),
      now: new Date(Date.now() + 25 * 60 * 60 * 1000),
    });
    assert.ok(sweep.eligible.includes(firstKey), "orphan is eligible for cleanup after 24h");
    await storage.delete(firstKey);
  });

  it("serializes concurrent replacements: one active avatar, no leaked or wrongly deleted objects", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const othersBefore = new Set(await storedFiles());
    othersBefore.delete(path.basename((await avatarKeyOf(user))!));

    const responses = await Promise.all([
      upload(user, await jpeg(500, 500)),
      upload(user, await png(700, 300), "image/png"),
      upload(user, await webp(300, 700), "image/webp"),
      upload(user, await jpeg(1200, 800)),
    ]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 200]);

    const activeKey = (await avatarKeyOf(user))!;
    const remaining = (await storedFiles()).filter((file) => !othersBefore.has(file));
    assert.deepEqual(remaining, [path.basename(activeKey)], "exactly the active object remains for this user");
    assert.equal((await raw("GET", (await api("GET", "/api/account", { token: user.token })).body.avatarUrl)).status, 200);
  });
});

// ---------- delete ----------

describe("DELETE /api/account/avatar", () => {
  it("clears the avatar, removes the object, and is idempotent", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const key = (await avatarKeyOf(user))!;

    const first = await removeAvatar(user);
    assert.equal(first.status, 200);
    assert.equal(first.body.avatarUrl, null);
    assert.equal(await avatarKeyOf(user), null);
    assert.ok(!(await storedFiles()).includes(path.basename(key)));

    const second = await removeAvatar(user);
    assert.equal(second.status, 200);
    assert.equal(second.body.avatarUrl, null);
  });

  it("succeeds with no avatar ever set", async () => {
    const user = await createTestUser(api, createdUserIds);
    const response = await removeAvatar(user);
    assert.equal(response.status, 200);
    assert.equal(response.body.avatarUrl, null);
  });

  it("clears the avatar even if the object can't be deleted (orphan for the sweep)", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const key = (await avatarKeyOf(user))!;

    storage.failDelete = true;
    const response = await removeAvatar(user);
    storage.failDelete = false;

    assert.equal(response.status, 200);
    assert.equal(response.body.avatarUrl, null);
    assert.equal(await avatarKeyOf(user), null);
    assert.ok((await storedFiles()).includes(path.basename(key)));

    const sweep = await sweepOrphanAvatars({ storage, referencedKeys: new Set(), now: new Date(Date.now() + 25 * 3_600_000) });
    assert.ok(sweep.eligible.includes(key));
    await storage.delete(key);
  });
});

// ---------- signed media ----------

describe("GET /api/media/avatars/:file (signed URLs)", () => {
  let user: TestUser;
  let url: string;
  let key: string;

  before(async () => {
    user = await createTestUser(api, createdUserIds);
    url = (await upload(user, await jpeg())).body.avatarUrl;
    key = keyFromUrl(url);
  });

  it("serves the stored image without a JWT, with safe headers", async () => {
    const response = await raw("GET", url);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.match(response.headers.get("cache-control") ?? "", /^private, max-age=\d+$/);
    assert.ok(response.bytes.equals(await readFile(fileOf(key))));
  });

  it("issues URLs that expire in about an hour", () => {
    const expires = Number(new URL(url, "http://x").searchParams.get("expires"));
    const remaining = expires - Date.now() / 1000;
    assert.ok(remaining > 59 * 60 && remaining <= 71 * 60, `remaining ${remaining}s`);
  });

  it("rejects expired, tampered and malformed URLs with 403", async () => {
    const parsed = new URL(url, "http://x");
    const expires = Number(parsed.searchParams.get("expires"));
    const signature = parsed.searchParams.get("signature")!;
    const base = `/api/media/${key}`;
    const past = Math.floor(Date.now() / 1000) - 10;
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    const otherKey = `avatars/${randomUUID()}.webp`;

    for (const [label, target] of [
      ["expired (validly signed)", `${base}?expires=${past}&signature=${signMediaKeyWithExpiry(key, past)}`],
      ["modified expiry", `${base}?expires=${expires + 600}&signature=${signature}`],
      ["modified signature", `${base}?expires=${expires}&signature=${flipped}`],
      ["modified key", `/api/media/${otherKey}?expires=${expires}&signature=${signature}`],
      ["missing signature", `${base}?expires=${expires}`],
      ["missing expiry", `${base}?signature=${signature}`],
      ["no query", base],
      ["duplicated params", `${base}?expires=${expires}&expires=${expires}&signature=${signature}`],
      ["non-numeric expiry", `${base}?expires=soon&signature=${signature}`],
      ["short signature", `${base}?expires=${expires}&signature=abc`],
    ] as const) {
      const response = await raw("GET", target);
      assert.equal(response.status, 403, label);
      assert.equal(response.body.message, "This media link is invalid or has expired.", label);
    }
  });

  it("does not sign the JWT way: a media signature is not a valid JWT and vice versa", async () => {
    const response = await raw("GET", `/api/media/${key}?expires=9999999999&signature=${user.token.split(".")[2]?.slice(0, 43)}`);
    assert.equal(response.status, 403);
  });

  it("blocks path traversal and arbitrary file reads", async () => {
    const expires = new URL(url, "http://x").searchParams.get("expires");
    for (const target of [
      "/api/media/avatars/..%2F..%2F.env",
      "/api/media/avatars/..%2f..%2fpackage.json",
      "/api/media/avatars/%2e%2e%2f%2e%2e%2f.env",
      "/api/media/avatars/....%2F%2F.env",
      `/api/media/avatars/${path.basename(key)}%00.png`,
      "/api/media/avatars/not-a-uuid.webp",
      "/api/media/../.env",
      "/api/media/avatars/",
      `/api/media/other/${path.basename(key)}?expires=${expires}`,
    ]) {
      const response = await raw("GET", target);
      assert.ok([400, 403, 404].includes(response.status), `${target} → ${response.status}`);
      assert.ok(!response.bytes.toString().includes("DATABASE_URL"), `${target} leaked a file`);
      assert.notEqual(response.headers.get("content-type"), "image/webp");
    }
  });

  it("returns 404 for a validly signed but missing object", async () => {
    const missing = `avatars/${randomUUID()}.webp`;
    const expires = Math.floor(Date.now() / 1000) + 600;
    const response = await raw("GET", `/api/media/${missing}?expires=${expires}&signature=${signMediaKeyWithExpiry(missing, expires)}`);
    assert.equal(response.status, 404);
    assert.equal(response.body.message, "Not found.");
  });
});

// ---------- account response ----------

describe("GET /api/account avatar fields", () => {
  it("returns avatarUrl: null without an avatar and a signed URL with one, never avatarKey", async () => {
    const user = await createTestUser(api, createdUserIds);
    const empty = await api("GET", "/api/account", { token: user.token });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.avatarUrl, null);
    assert.ok(!("avatarKey" in empty.body));

    await upload(user, await jpeg());
    const withAvatar = await api("GET", "/api/account", { token: user.token });
    assert.match(withAvatar.body.avatarUrl, AVATAR_URL_PATTERN);
    assert.ok(!JSON.stringify(withAvatar.body).includes("avatarKey"));

    // Other account responses carry the same field.
    const patched = await api("PATCH", "/api/account/profile", { token: user.token, body: { bio: "hello" } });
    assert.match(patched.body.avatarUrl, AVATAR_URL_PATTERN);
    assert.ok(!("avatarKey" in patched.body));
  });

  it("does not expose avatarKey through the fitness-profile endpoint", async () => {
    const user = await createTestUser(api, createdUserIds);
    await upload(user, await jpeg());
    const profile = await api("GET", "/api/profile/me", { token: user.token });
    assert.ok(!JSON.stringify(profile.body).includes("avatar"));
  });
});

// ---------- orphan cleanup ----------

describe("orphan avatar sweep", () => {
  it("keeps referenced and young objects; deletes only old orphans, and only when asked", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fitai-sweep-test-"));
    const sweepStorage = new LocalObjectStorage(root);
    const now = new Date();
    const referenced = `avatars/${randomUUID()}.webp`;
    const young = `avatars/${randomUUID()}.webp`;
    const old = `avatars/${randomUUID()}.webp`;
    const oldButReferenced = `avatars/${randomUUID()}.webp`;

    for (const key of [referenced, young, old, oldButReferenced]) {
      await sweepStorage.put(key, Buffer.from("x"), "image/webp");
    }
    const twoDaysAgo = new Date(now.getTime() - 48 * 3_600_000);
    await utimes(path.join(root, old), twoDaysAgo, twoDaysAgo);
    await utimes(path.join(root, oldButReferenced), twoDaysAgo, twoDaysAgo);
    // A stray temp file from an interrupted write is never treated as an avatar.
    await writeFile(path.join(root, "avatars", "stray.webp.tmp"), "x");

    try {
      const referencedKeys = new Set([referenced, oldButReferenced]);
      const dryRun = await sweepOrphanAvatars({ storage: sweepStorage, referencedKeys, now });

      assert.equal(dryRun.scanned, 4);
      assert.equal(dryRun.referenced, 2);
      assert.deepEqual(dryRun.youngOrphans, [young]);
      assert.deepEqual(dryRun.eligible, [old]);
      assert.deepEqual(dryRun.deleted, [], "dry run deletes nothing");
      assert.equal((await readdir(path.join(root, "avatars"))).length, 5);

      const real = await sweepOrphanAvatars({ storage: sweepStorage, referencedKeys, now, dryRun: false });
      assert.deepEqual(real.deleted, [old]);
      const left = (await readdir(path.join(root, "avatars"))).sort();
      assert.deepEqual(left, [path.basename(referenced), path.basename(young), path.basename(oldButReferenced), "stray.webp.tmp"].sort());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
