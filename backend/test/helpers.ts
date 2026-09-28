import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import app from "../src/app.js";
import prisma from "../src/lib/prisma.js";

export { prisma };

export const TEST_PASSWORD = "TestPassword123!";

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export type Api = <T = any>(
  method: string,
  path: string,
  options?: { token?: string; body?: unknown }
) => Promise<ApiResult<T>>;

export function createApi(baseUrl: string): Api {
  return async (method, path, options = {}) => {
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const isJson = response.headers.get("content-type")?.includes("application/json");

    return {
      status: response.status,
      // Non-JSON responses (e.g. Express's default HTML 404) are returned as text.
      body: text ? (isJson ? JSON.parse(text) : text) : null,
    };
  };
}

export interface TestUser {
  id: number;
  email: string;
  token: string;
}

/** Registers and logs in a uniquely named user through the real auth API. */
export async function createTestUser(
  api: Api,
  createdUserIds: number[]
): Promise<TestUser> {
  const email = `test-${randomUUID()}@fitai-test.local`;

  const registered = await api("POST", "/api/auth/register", {
    body: { firstName: "Test", lastName: "User", email, password: TEST_PASSWORD },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));

  const loggedIn = await api("POST", "/api/auth/login", {
    body: { email, password: TEST_PASSWORD },
  });
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));

  const user = { id: loggedIn.body.user.id as number, email, token: loggedIn.body.token as string };
  createdUserIds.push(user.id);

  return user;
}

/** Deleting users cascades to all of their data (workouts, custom exercises, ...). */
export async function deleteTestUsers(userIds: number[]): Promise<void> {
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

export async function builtInExerciseId(builtInKey: string): Promise<number> {
  const exercise = await prisma.exercise.findUnique({
    where: { builtInKey },
    select: { id: true },
  });
  assert.ok(exercise, `Built-in exercise ${builtInKey} is not seeded`);

  return exercise.id;
}

/** Error field paths from a standard 400 validation response. */
export function errorFields(body: { errors?: { field: string }[] }): string[] {
  return (body.errors ?? []).map((error) => error.field);
}
