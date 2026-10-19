#!/usr/bin/env node
/**
 * Gestione delle credenziali direttamente sul database.
 *
 * Il login NON vive nelle variabili d'ambiente: username e passwordHash sono
 * nella tabella `User` di SQLite (vedi prisma/schema.prisma). Questo script
 * crea il primo utente (admin) su un DB vuoto oppure reimposta la password di
 * un utente esistente, senza passare da BOOTSTRAP_* (che resta solo un seed di
 * primo avvio per un DB vuoto).
 *
 * Uso:
 *   npm run --workspace apps/server user:set-password -- <username> <password>
 *
 * Esempi:
 *   npm run --workspace apps/server user:set-password -- admin admin123
 *
 * Richiede DATABASE_URL (letto da apps/server/.env via dotenv, cwd = apps/server).
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error("Uso: npm run --workspace apps/server user:set-password -- <username> <password>");
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
    await prisma.user.create({ data: { username, passwordHash, role: "admin" } });
    console.log(`Utente amministratore "${username}" creato nel database.`);
  } else {
    const current = await prisma.user.findUnique({ where: { username } });
    if (!current) {
      console.error(
        `Utente "${username}" non trovato. Gli altri utenti si gestiscono dalla UI ` +
          "(sezione Utenti, solo admin) oppure indicando uno username esistente.",
      );
      process.exit(1);
    }
    await prisma.user.update({
      where: { id: current.id },
      data: { passwordHash },
    });
    console.log(`Password dell'utente "${username}" aggiornata nel database.`);
  }
} finally {
  await prisma.$disconnect();
}
