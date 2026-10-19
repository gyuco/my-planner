import type { FastifyInstance } from "fastify";
import { createUserInputSchema, updateUserInputSchema } from "../lib/validation.js";
import { createUser, deleteUser, listUsers, updateUser } from "../services/userService.js";

/**
 * Gestione utenti, riservata agli admin (il controllo di ruolo e' applicato
 * dal hook `requireAdmin` registrato su queste route in index.ts).
 */
export async function userRoutes(app: FastifyInstance) {
  app.get("/users", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return listUsers();
  });

  app.post("/users", { onRequest: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const input = createUserInputSchema.parse(req.body ?? {});
    const user = await createUser(input);
    return reply.code(201).send(user);
  });

  app.patch("/users/:userId", { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const { userId } = req.params as { userId: string };
    const input = updateUserInputSchema.parse(req.body ?? {});
    return updateUser(userId, input, (req as any).authUser.id);
  });

  app.delete("/users/:userId", { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const { userId } = req.params as { userId: string };
    return deleteUser(userId, (req as any).authUser.id);
  });
}
