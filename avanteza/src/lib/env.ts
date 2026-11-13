// Leitura centralizada de variáveis de ambiente. Nunca registre valores em log.

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export function envOptional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function appUrl(): string {
  return (envOptional("APP_URL") ?? "https://app.avanteza.com.br").replace(/\/$/, "");
}

export function adminEmails(): string[] {
  return (envOptional("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Lista quais configurações obrigatórias estão faltando (só nomes, nunca valores). */
export function missingConfig(): string[] {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ML_CLIENT_ID",
    "ML_CLIENT_SECRET",
    "ENCRYPTION_KEY",
    "CRON_SECRET",
    "ADMIN_EMAILS",
  ];
  return required.filter((n) => !envOptional(n));
}
