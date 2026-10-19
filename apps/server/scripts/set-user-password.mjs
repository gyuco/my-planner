#!/usr/bin/env node
/**
 * Gestione delle credenziali direttamente sul database.
 *
 * Il login NON vive nelle variabili d'ambiente: email e passwordHash sono
 * nella tabella `User` di SQLite (vedi prisma/schema.prisma). Questo script
 * crea il primo utente (admin) su un DB vuoto oppure reimposta la password di
 * un utente esistente, senza passare da BOOTSTRAP_* (che resta solo un seed di
 * primo avvio per un DB vuoto).
 *
 * Uso:
 *   npm run --workspace apps/server user:set-password -- <email> <password>
 *
 * Esempi:
 *   npm run --workspace apps/server user:set-password -- admin@example.com admin123
 *
 * Richiede DATABASE_URL (letto da apps/server/.env via dotenv, cwd = apps/server).
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [emailArg, password] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();

if (!email || !password) {
  console.error("Uso: npm run --workspace apps/server user:set-password -- <email> <password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("La password deve essere lunga almeno 8 caratteri.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL mancante. Crea apps/server/.env con DATABASE_URL=\"file:./dev.db\" " +
      "(vedi config.example.md).",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    await prisma.user.create({ data: { email, passwordHash, role: "admin" } });
    console.log(`Utente amministratore "${email}" creato nel database.`);
  } else {
    const current = await prisma.user.findUnique({ where: { email } });
    if (!current) {
      console.error(
        `Utente "${email}" non trovato. Gli altri utenti si gestiscono dalla UI ` +
          "(sezione Utenti, solo admin) oppure indicando un'email esistente.",
      );
      process.exit(1);
    }
    await prisma.user.update({
      where: { id: current.id },
      data: { passwordHash },
    });
    console.log(`Password dell'utente "${email}" aggiornata nel database.`);
  }
} finally {
  await prisma.$disconnect();
}
