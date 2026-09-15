import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Credenziali non valide" });
    }
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return { token };
  });
}
