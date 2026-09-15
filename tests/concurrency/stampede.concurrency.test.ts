import type { Redis } from "ioredis";
import { jest } from "@jest/globals";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { prisma } from "../../src/config/database.config.js";

class InMemoryRedis {
  private readonly values = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async set(
    key: string,
    value: string,
    firstOption: string,
    secondOption: number,
    thirdOption?: string,
  ): Promise<"OK" | null> {
    if (thirdOption === "NX" && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return "OK";
  }

  public async evalsha(): Promise<number> {
    return 1;
  }
}

describe("seating map cache stampede protection", (): void => {
  it("hydrates PostgreSQL once for concurrent cache misses", async (): Promise<void> => {
    const databaseLoader = jest
      .fn<
        (args: Parameters<typeof prisma.event.findUnique>[0]) => Promise<{
          id: string;
          name: string;
          startsAt: Date;
          seats: unknown[];
        }>
      >()
      .mockResolvedValue({
        id: "event-1",
        name: "Test Event",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        seats: [],
      });
    const redisClient = new InMemoryRedis();

    jest.unstable_mockModule("../../src/config/database.config.js", () => ({
      prisma: { event: { findUnique: databaseLoader } },
    }));
    jest.unstable_mockModule("../../src/config/redis.config.js", () => ({
      redis: redisClient,
    }));
    jest.unstable_mockModule("../../src/scripts/lua-loader.js", () => ({
      getLuaScriptDigest: jest.fn().mockReturnValue("release-digest"),
    }));

    const { getSeatingMap } =
      await import("../../src/services/stampede.service.js");
    const results = await Promise.all(
      Array.from(
        { length: 50 },
        async (): Promise<unknown> =>
          getSeatingMap("event-1", redisClient as unknown as Redis),
      ),
    );

    expect(databaseLoader).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(50);
    expect(results.every((result) => result !== null)).toBe(true);
  });
});
