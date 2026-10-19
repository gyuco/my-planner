import type { AuthUser } from "@my-planner/core";

const TOKEN_KEY = "my-planner:jwt";
const USER_KEY = "my-planner:user";

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Salva l'utente corrente (ruolo e progetti) per il primo render dopo un reload. */
export function saveUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed?.id || !parsed.username || (parsed.role !== "admin" && parsed.role !== "manager")) {
      return null;
    }
    return {
      id: parsed.id,
      username: parsed.username,
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : "",
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : "",
      email: typeof parsed.email === "string" ? parsed.email : null,
      role: parsed.role,
      projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds : [],
    };
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Verifica che il JWT salvato non sia scaduto, decodificando il payload
 * lato client (nessuna validazione di firma: è solo un controllo di
 * comodo per decidere se mostrare login o app; il server valida sempre
 * la firma su ogni richiesta autenticata).
 */
export function hasValidToken(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return false;
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp) return true;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
