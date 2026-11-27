import { describe, expect, it } from "vitest";
import { PrismaD1 } from "@prisma/adapter-d1";
import { patchD1DateInference } from "./d1DateFix.js";

function fakeD1(columnNames: string[], rows: unknown[][]) {
  return {
    prepare: () => ({
      bind: () => ({ raw: async () => [columnNames, ...rows.map((r) => [...r])] }),
    }),
  };
}

async function query(columnNames: string[], rows: unknown[][]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaD1(fakeD1(columnNames, rows) as any);
  const res = await adapter.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] });
  if (!res.ok) throw new Error("query failed");
  return res.value.columnTypes;
}

describe("patchD1DateInference", () => {
  patchD1DateInference();

  it("un testo che contiene un timestamp ISO resta Text", async () => {
    const types = await query(["description"], [["fake timers at 2026-11-28T01:00:00Z expecting 2026-11-27"]]);
    expect(types).toEqual([7]);
  });

  it("le vere date restano DateTime", async () => {
    const types = await query(["createdAt"], [["2026-11-27T10:00:00.000Z"], ["2026-11-27 10:00:00"]]);
    expect(types).toEqual([10]);
  });

  it("una colonna con una data vera seguita da testo diventa Text", async () => {
    const types = await query(["title"], [["2026-11-27T10:00:00Z"], ["non una data"]]);
    expect(types).toEqual([7]);
  });
});
