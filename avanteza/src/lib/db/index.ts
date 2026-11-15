// Acesso ao banco (Neon/Postgres). Só no servidor. O controle de acesso é feito por requireAdmin()
// nas páginas/ações e por CRON_SECRET/state nas rotas públicas.
import { db } from "./client";

export const adminDb = () => db;
export const userDb = async () => db;
