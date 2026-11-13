// Cliente com a sessão do usuário (RLS aplicado). Usado em Server Components e Server Actions.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

export async function userDb() {
  const cookieStore = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "avanteza" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* chamado em Server Component: o middleware renova os cookies */
        }
      },
    },
  });
}
