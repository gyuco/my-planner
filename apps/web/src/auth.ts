const TOKEN_KEY = "my-planner:jwt";

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
