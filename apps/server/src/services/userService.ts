import bcrypt from "bcryptjs";
import {
  ApiErrorException,
  type AuthUser,
  type UserAccount,
  type UserRole,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

/**
 * Gestione utenti e autorizzazione per progetto, condivisa tra runtime Node
 * (Fastify) e Cloudflare Workers (Hono).
 *
 * Regole:
 *  - admin: accesso implicito a tutti i progetti e alla gestione utenti;
 *  - manager: accesso solo ai progetti elencati in UserProject.
 *
 * Le decisioni di autorizzazione vivono qui (non nei singoli route handler)
 * cosi' REST Node e REST Cloudflare applicano esattamente le stesse regole.
 */

const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 100;

export function normalizeRole(role: string | null | undefined): UserRole {
  return role === "admin" ? "admin" : "manager";
}

export function assertAdmin(user: AuthUser) {
  if (user.role !== "admin") {
    throw new ApiErrorException("FORBIDDEN", "Operazione riservata agli amministratori");
  }
}

export function isAdmin(user: AuthUser): boolean {
  return user.role === "admin";
}

/** Carica il contesto di autorizzazione dell'utente; null se non esiste piu'. */
export async function getAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { projects: { select: { projectId: true } } },
  });
  if (!user) return null;
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    username: user.username,
    role,
    projectIds: role === "admin" ? [] : user.projects.map((p) => p.projectId),
  };
}

export async function assertProjectAccess(user: AuthUser, projectId: string): Promise<void> {
  if (isAdmin(user)) return;
  if (!user.projectIds.includes(projectId)) {
    throw new ApiErrorException("FORBIDDEN", "Non hai accesso a questo progetto");
  }
}

export async function assertTaskAccess(
  user: AuthUser,
  taskId: string,
): Promise<{ projectId: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
  await assertProjectAccess(user, task.projectId);
  return task;
}

export async function assertAttachmentAccess(
  user: AuthUser,
  attachmentId: string,
): Promise<{ taskId: string; projectId: string }> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { task: { select: { projectId: true } } },
  });
  if (!attachment) throw new ApiErrorException("NOT_FOUND", "Allegato non trovato");
  await assertProjectAccess(user, attachment.task.projectId);
  return { taskId: attachment.taskId, projectId: attachment.task.projectId };
}

/** Progetti visibili all'utente (tutti per l'admin, solo gli assegnati per il manager). */
export async function listProjectsForUser(user: AuthUser, includeArchived = false) {
  const where: Record<string, unknown> = includeArchived ? {} : { archived: false };
  if (!isAdmin(user)) {
    where.members = { some: { userId: user.id } };
  }
  return prisma.project.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Limita un elenco di projectId richiesto dal client a quelli accessibili.
 * Per il manager senza filtro esplicito ritorna i suoi progetti.
 */
export function restrictProjectIds(user: AuthUser, requested: string[] | undefined): string[] | undefined {
  if (isAdmin(user)) return requested;
  if (!requested || requested.length === 0) return user.projectIds;
  return requested.filter((id) => user.projectIds.includes(id));
}

function serializeAccount(user: any): UserAccount {
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    username: user.username,
    role,
    createdAt: new Date(user.createdAt).toISOString(),
    projectIds: user.projects.map((p: any) => p.projectId),
    projects: user.projects.map((p: any) => ({ id: p.project.id, name: p.project.name })),
  };
}

async function getUserWithProjects(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { projects: { include: { project: true }, orderBy: { project: { name: "asc" } } } },
  });
  if (!user) throw new ApiErrorException("NOT_FOUND", "Utente non trovato");
  return user;
}

async function validateProjectIds(projectIds: string[]): Promise<string[]> {
  const unique = Array.from(new Set(projectIds.filter(Boolean)));
  if (unique.length === 0) return [];
  const projects = await prisma.project.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  if (projects.length !== unique.length) {
    throw new ApiErrorException("VALIDATION_ERROR", "Uno o piu' progetti selezionati non esistono");
  }
  return unique;
}

function validateUsername(username: string): string {
  const value = username.trim();
  if (value.length === 0 || value.length > MAX_USERNAME_LENGTH) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `username deve avere tra 1 e ${MAX_USERNAME_LENGTH} caratteri`,
    );
  }
  return value;
}

function validatePassword(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`,
    );
  }
  return password;
}

function validateRole(role: string): UserRole {
  if (role !== "admin" && role !== "manager") {
    throw new ApiErrorException("VALIDATION_ERROR", "role deve essere 'admin' oppure 'manager'");
  }
  return role;
}

async function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: "admin" } });
}

export async function listUsers(): Promise<UserAccount[]> {
  const users = await prisma.user.findMany({
    include: { projects: { include: { project: true }, orderBy: { project: { name: "asc" } } } },
    orderBy: { createdAt: "asc" },
  });
  return users.map(serializeAccount);
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: string;
  projectIds?: string[];
}

export async function createUser(input: CreateUserInput): Promise<UserAccount> {
  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const role = validateRole(input.role);

  let projectIds: string[] = [];
  if (role === "manager") {
    projectIds = await validateProjectIds(input.projectIds ?? []);
    if (projectIds.length === 0) {
      throw new ApiErrorException(
        "VALIDATION_ERROR",
        "Un manager deve essere associato ad almeno un progetto",
      );
    }
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new ApiErrorException("CONFLICT", `Esiste gia' un utente con username "${username}"`);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const created = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
        projects:
          projectIds.length > 0
            ? { create: projectIds.map((projectId) => ({ projectId })) }
            : undefined,
      },
    });
    return serializeAccount(await getUserWithProjects(created.id));
  } catch {
    // Corsa con un'altra creazione dello stesso username (unique constraint).
    const nowExisting = await prisma.user.findUnique({ where: { username } });
    if (nowExisting) {
      throw new ApiErrorException("CONFLICT", `Esiste gia' un utente con username "${username}"`);
    }
    throw new ApiErrorException("INTERNAL_ERROR", "Impossibile creare l'utente");
  }
}

export interface UpdateUserInput {
  role?: string;
  password?: string;
  projectIds?: string[];
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<UserAccount> {
  const existing = await getUserWithProjects(userId);
  const currentRole = normalizeRole(existing.role);
  const nextRole = input.role !== undefined ? validateRole(input.role) : currentRole;

  if (userId === actorId && currentRole === "admin" && nextRole !== "admin") {
    throw new ApiErrorException("VALIDATION_ERROR", "Non puoi rimuovere il ruolo admin al tuo utente");
  }
  if (currentRole === "admin" && nextRole !== "admin") {
    const admins = await countAdmins();
    if (admins <= 1) {
      throw new ApiErrorException("VALIDATION_ERROR", "Deve rimanere almeno un amministratore");
    }
  }

  let projectIds: string[] = [];
  if (nextRole === "manager") {
    projectIds = await validateProjectIds(
      input.projectIds ?? existing.projects.map((p) => p.projectId),
    );
    if (projectIds.length === 0) {
      throw new ApiErrorException(
        "VALIDATION_ERROR",
        "Un manager deve essere associato ad almeno un progetto",
      );
    }
  }

  const data: any = { role: nextRole };
  if (input.password !== undefined) {
    data.passwordHash = await bcrypt.hash(validatePassword(input.password), 10);
  }
  data.projects =
    nextRole === "manager"
      ? {
          deleteMany: {},
          create: projectIds.map((projectId) => ({ projectId })),
        }
      : { deleteMany: {} };

  await prisma.user.update({ where: { id: userId }, data });
  return serializeAccount(await getUserWithProjects(userId));
}

export async function deleteUser(userId: string, actorId: string): Promise<{ id: string; deleted: true }> {
  if (userId === actorId) {
    throw new ApiErrorException("VALIDATION_ERROR", "Non puoi eliminare il tuo utente");
  }
  const existing = await getUserWithProjects(userId);
  if (normalizeRole(existing.role) === "admin") {
    const admins = await countAdmins();
    if (admins <= 1) {
      throw new ApiErrorException("VALIDATION_ERROR", "Deve rimanere almeno un amministratore");
    }
  }
  await prisma.user.delete({ where: { id: userId } });
  return { id: userId, deleted: true };
}
