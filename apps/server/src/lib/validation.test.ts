import { describe, it, expect } from "vitest";
import {
  taskInputSchema,
  taskUpdateInputSchema,
  moveTaskInputSchema,
  dependencyInputSchema,
  commentInputSchema,
  projectNameInputSchema,
  complexitySchema,
} from "./validation.js";

describe("validation — taskInputSchema", () => {
  it("accetta un input valido minimale", () => {
    const result = taskInputSchema.safeParse({ title: "Task valido" });
    expect(result.success).toBe(true);
  });

  it("rifiuta title mancante o vuoto", () => {
    expect(taskInputSchema.safeParse({}).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rifiuta title oltre 300 caratteri", () => {
    expect(taskInputSchema.safeParse({ title: "a".repeat(301) }).success).toBe(false);
  });

  it("rifiuta complexity non-Fibonacci", () => {
    expect(taskInputSchema.safeParse({ title: "T", complexity: 4 }).success).toBe(false);
  });

  it("accetta complexity null e valori Fibonacci ammessi", () => {
    expect(taskInputSchema.safeParse({ title: "T", complexity: null }).success).toBe(true);
    expect(taskInputSchema.safeParse({ title: "T", complexity: 13 }).success).toBe(true);
  });

  it("rifiuta priority fuori enum", () => {
    expect(taskInputSchema.safeParse({ title: "T", priority: "urgentissimo" }).success).toBe(false);
  });

  it("rifiuta dueDate non ISO8601", () => {
    expect(taskInputSchema.safeParse({ title: "T", dueDate: "15-09-2026" }).success).toBe(false);
  });

  it("accetta dueDate null", () => {
    expect(taskInputSchema.safeParse({ title: "T", dueDate: null }).success).toBe(true);
  });
});

describe("validation — taskUpdateInputSchema", () => {
  it("accetta oggetto vuoto (tutti i campi opzionali)", () => {
    expect(taskUpdateInputSchema.safeParse({}).success).toBe(true);
  });

  it("rifiuta title vuoto se presente", () => {
    expect(taskUpdateInputSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("validation — moveTaskInputSchema", () => {
  it("accetta status valido senza position", () => {
    expect(moveTaskInputSchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });

  it("rifiuta status fuori enum", () => {
    expect(moveTaskInputSchema.safeParse({ status: "archiviato" }).success).toBe(false);
  });

  it("rifiuta position negativa o non intera", () => {
    expect(moveTaskInputSchema.safeParse({ status: "draft", position: -1 }).success).toBe(false);
    expect(moveTaskInputSchema.safeParse({ status: "draft", position: 1.5 }).success).toBe(false);
  });
});

describe("validation — dependencyInputSchema", () => {
  it("rifiuta blockedByTaskId mancante o vuoto", () => {
    expect(dependencyInputSchema.safeParse({}).success).toBe(false);
    expect(dependencyInputSchema.safeParse({ blockedByTaskId: "" }).success).toBe(false);
  });

  it("accetta blockedByTaskId valorizzato", () => {
    expect(dependencyInputSchema.safeParse({ blockedByTaskId: "abc123" }).success).toBe(true);
  });
});

describe("validation — commentInputSchema", () => {
  it("rifiuta body vuoto", () => {
    expect(commentInputSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("accetta body valorizzato", () => {
    expect(commentInputSchema.safeParse({ body: "ciao" }).success).toBe(true);
  });
});

describe("validation — projectNameInputSchema", () => {
  it("rifiuta name vuoto o oltre 200 caratteri", () => {
    expect(projectNameInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(projectNameInputSchema.safeParse({ name: "a".repeat(201) }).success).toBe(false);
  });

  it("accetta name valido", () => {
    expect(projectNameInputSchema.safeParse({ name: "Progetto" }).success).toBe(true);
  });
});

describe("validation — complexitySchema (coerenza REST/MCP)", () => {
  it("accetta solo valori Fibonacci ammessi, null o undefined", () => {
    for (const v of [1, 2, 3, 5, 8, 13, 21, null, undefined]) {
      expect(complexitySchema.safeParse(v).success).toBe(true);
    }
    for (const v of [0, 4, 6, 100, "5"]) {
      expect(complexitySchema.safeParse(v).success).toBe(false);
    }
  });
});
