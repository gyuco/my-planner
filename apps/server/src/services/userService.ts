import bcrypt from "bcryptjs";
import {
  ApiErrorException,
  type AuthUser,
  type TaskAssignee,
  type UserAccount,
  type UserRole,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { initNotificationStateForUser } from "./notificationService.js";

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
const MAX_EMAIL_LENGTH = 200;

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
    email: user.email,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
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

/**
 * Assegnatari possibili per i task di un progetto: tutti gli admin piu' i
 * manager associati al progetto (stessa regola validata da taskService).
 */
export async function listProjectAssignees(projectId: string): Promise<TaskAssignee[]> {
  const users = await prisma.user.findMany({
    where: { OR: [{ role: "admin" }, { projects: { some: { projectId } } }] },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { email: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
  }));
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
    email: user.email,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
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

const MAX_NAME_LENGTH = 100;

function validateName(value: string | undefined | null, field: "firstName" | "lastName"): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `${field} deve avere al massimo ${MAX_NAME_LENGTH} caratteri`,
    );
  }
  return trimmed;
}

/**
 * Normalizza e valida l'email, che e' anche l'identificativo di login. Sempre
 * obbligatoria; il formato e' volutamente permissivo (una sola @ e un punto nel
 * dominio) ma abbastanza stretto da intercettare gli errori di battitura.
 */
function validateEmail(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "email obbligatoria");
  }
  if (trimmed.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ApiErrorException("VALIDATION_ERROR", "email non valida");
  }
  return trimmed;
}

/** Email gia' usata da un altro utente (escluso `excludeUserId`). */
async function assertEmailAvailable(email: string, excludeUserId?: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== excludeUserId) {
    throw new ApiErrorException("CONFLICT", `Esiste gia' un utente con email "${email}"`);
  }
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
  email: string;
  password: string;
  role: string;
  firstName?: string;
  lastName?: string;
  projectIds?: string[];
}

export async function createUser(input: CreateUserInput): Promise<UserAccount> {
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  const role = validateRole(input.role);
  const firstName = validateName(input.firstName, "firstName");
  const lastName = validateName(input.lastName, "lastName");

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

  await assertEmailAvailable(email);

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        firstName,
        lastName,
        projects:
          projectIds.length > 0
            ? { create: projectIds.map((projectId) => ({ projectId })) }
            : undefined,
      },
    });
    // Cursore notifiche ancorato alla creazione dell'account: il nuovo utente
    // non deve vedere gli eventi avvenuti prima che esistesse.
    await initNotificationStateForUser(created.id);
    return serializeAccount(await getUserWithProjects(created.id));
  } catch {
    // Corsa con un'altra creazione della stessa email (unique constraint).
    const nowExisting = await prisma.user.findUnique({ where: { email } });
    if (nowExisting) {
      throw new ApiErrorException("CONFLICT", `Esiste gia' un utente con email "${email}"`);
    }
    throw new ApiErrorException("INTERNAL_ERROR", "Impossibile creare l'utente");
  }
}

export interface UpdateUserInput {
  role?: string;
  password?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
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
  if (input.firstName !== undefined) {
    data.firstName = validateName(input.firstName, "firstName");
  }
  if (input.lastName !== undefined) {
    data.lastName = validateName(input.lastName, "lastName");
  }
  if (input.email !== undefined) {
    const email = validateEmail(input.email);
    await assertEmailAvailable(email, userId);
    data.email = email;
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

export interface UpdateProfileInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Modifica dei dati che l'utente puo' cambiare da solo nella pagina profilo:
 * nome, cognome ed email. L'email e' l'identificativo di login; ruolo e
 * progetti restano in mano agli admin.
 */
export async function updateOwnProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new ApiErrorException("NOT_FOUND", "Utente non trovato");

  const email = validateEmail(input.email);
  await assertEmailAvailable(email, userId);
  const data: { email: string; firstName?: string; lastName?: string } = { email };
  if (input.firstName !== undefined) data.firstName = validateName(input.firstName, "firstName");
  if (input.lastName !== undefined) data.lastName = validateName(input.lastName, "lastName");
  await prisma.user.update({ where: { id: userId }, data });

  const updated = await getAuthUser(userId);
  if (!updated) throw new ApiErrorException("NOT_FOUND", "Utente non trovato");
  return updated;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Cambio password self-service: richiede la password attuale, verifica i
 * requisiti minimi e salva il nuovo hash. Il JWT corrente resta valido perché
 * l'identità è legata all'id utente, non alla password.
 */
export async function changeOwnPassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiErrorException("NOT_FOUND", "Utente non trovato");

  const currentOk = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new ApiErrorException("VALIDATION_ERROR", "La password attuale non è corretta");
  }

  const newPassword = validatePassword(input.newPassword);
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      "La nuova password deve essere diversa da quella attuale",
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
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
