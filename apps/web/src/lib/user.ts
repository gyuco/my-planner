import type { AuthUser, UserAccount } from "@my-planner/core";

type NamedUser = Pick<AuthUser, "firstName" | "lastName" | "email">;

/**
 * Nome completo da mostrare in UI, con fallback sull'email finché
 * nome/cognome non sono stati compilati.
 */
export function displayName(user: NamedUser | UserAccount): string {
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return full.length > 0 ? full : user.email;
}

/** Iniziali per l'avatar del profilo. */
export function userInitials(user: NamedUser): string {
  const first = user.firstName.trim().charAt(0);
  const last = user.lastName.trim().charAt(0);
  if (first || last) return `${first}${last}`.toUpperCase();
  const local = user.email.split("@")[0] ?? user.email;
  return local.slice(0, 2).toUpperCase();
}
