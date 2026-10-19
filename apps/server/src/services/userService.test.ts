import { describe, it, expect } from "vitest";
import { createProject } from "./taskService.js";
import {
  assertProjectAccess,
  createUser,
  deleteUser,
  getAuthUser,
  listProjectsForUser,
  listUsers,
  updateOwnProfile,
  updateUser,
} from "./userService.js";

async function createAdmin(username = "admin") {
  return createUser({ username, password: "password123", role: "admin" });
}

describe("userService — ruoli e assegnazioni", () => {
  it("crea un manager associato ai progetti e ne espone il contesto auth", async () => {
    const admin = await createAdmin();
    const project = await createProject("Progetto A");
    const manager = await createUser({
      username: "manager",
      password: "password123",
      role: "manager",
      projectIds: [project.id],
    });

    expect(manager.role).toBe("manager");
    expect(manager.projectIds).toEqual([project.id]);
    expect(manager.projects).toEqual([{ id: project.id, name: "Progetto A" }]);

    const authUser = await getAuthUser(manager.id);
    expect(authUser).toMatchObject({
      id: manager.id,
      username: "manager",
      role: "manager",
      projectIds: [project.id],
    });

    const adminAuth = await getAuthUser(admin.id);
    expect(adminAuth?.role).toBe("admin");
    expect(adminAuth?.projectIds).toEqual([]);
  });

  it("limita i progetti visibili ai manager e lascia tutto agli admin", async () => {
    const admin = await createAdmin();
    const projectA = await createProject("A");
    const projectB = await createProject("B");
    const manager = await createUser({
      username: "manager",
      password: "password123",
      role: "manager",
      projectIds: [projectA.id],
    });

    const adminAuth = await getAuthUser(admin.id);
    const managerAuth = await getAuthUser(manager.id);

    const adminProjects = await listProjectsForUser(adminAuth!);
    expect(adminProjects.map((p) => p.id).sort()).toEqual([projectA.id, projectB.id].sort());

    const managerProjects = await listProjectsForUser(managerAuth!);
    expect(managerProjects.map((p) => p.id)).toEqual([projectA.id]);

    await expect(assertProjectAccess(managerAuth!, projectB.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(assertProjectAccess(managerAuth!, projectA.id)).resolves.toBeUndefined();
  });

  it("rifiuta un manager senza progetti e username duplicati", async () => {
    await createAdmin();
    await expect(
      createUser({ username: "manager", password: "password123", role: "manager" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      createUser({ username: "admin", password: "password123", role: "admin" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("aggiorna assegnazioni e ruolo, svuotando i progetti quando diventa admin", async () => {
    await createAdmin();
    const projectA = await createProject("A");
    const projectB = await createProject("B");
    const manager = await createUser({
      username: "manager",
      password: "password123",
      role: "manager",
      projectIds: [projectA.id],
    });

    const updated = await updateUser(manager.id, { projectIds: [projectB.id] }, manager.id);
    expect(updated.projectIds).toEqual([projectB.id]);

    const promoted = await updateUser(manager.id, { role: "admin" }, manager.id);
    expect(promoted.role).toBe("admin");
    expect(promoted.projectIds).toEqual([]);
  });

  it("impedisce di rimuovere l'ultimo amministratore o se stessi", async () => {
    const admin = await createAdmin();
    const manager = await createUser({
      username: "manager",
      password: "password123",
      role: "manager",
      projectIds: [(await createProject("A")).id],
    });

    await expect(updateUser(admin.id, { role: "manager", projectIds: [manager.projectIds[0]] }, admin.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(deleteUser(admin.id, admin.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Il manager non e' l'ultimo admin: puo' essere eliminato.
    await expect(deleteUser(manager.id, admin.id)).resolves.toEqual({ id: manager.id, deleted: true });

    const users = await listUsers();
    expect(users.map((u) => u.username)).toEqual(["admin"]);
  });

  it("valida id progetto inesistenti", async () => {
    await createAdmin();
    await expect(
      createUser({
        username: "manager",
        password: "password123",
        role: "manager",
        projectIds: ["progetto-inesistente"],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("salva nome, cognome ed email e aggiorna l'email dal profilo", async () => {
    const admin = await createUser({
      username: "admin",
      password: "password123",
      role: "admin",
      firstName: "  Ada  ",
      lastName: "Lovelace",
      email: "Ada@Example.com",
    });
    expect(admin.firstName).toBe("Ada");
    expect(admin.lastName).toBe("Lovelace");
    expect(admin.email).toBe("ada@example.com");

    const updated = await updateOwnProfile(admin.id, { email: "ada@nuovo.example" });
    expect(updated).toMatchObject({
      id: admin.id,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@nuovo.example",
    });

    // Email vuota = rimozione.
    const cleared = await updateOwnProfile(admin.id, { email: "" });
    expect(cleared.email).toBeNull();

    await expect(updateOwnProfile(admin.id, { email: "non-una-email" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
