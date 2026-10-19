import type { AuthUser, UserAccount } from "@my-planner/core";

type NamedUser = Pick<AuthUser, "firstName" | "lastName" | "username">;

/**
 * Nome completo da mostrare in UI, con fallback sullo username finché
 * nome/cognome non sono stati compilati (utenti creati prima del profilo).
 */
export function displayName(user: NamedUser | UserAccount): string {
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return full.length > 0 ? full : user.username;
}

/** Iniziali per l'avatar del profilo. */
export function userInitials(user: NamedUser): string {
  const first = user.firstName.trim().charAt(0);
  const last = user.lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
  return user.username.slice(0, 2).toUpperCase();
}
