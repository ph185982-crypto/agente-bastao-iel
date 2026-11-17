// Provedor plugável da busca no Comercial (Vendedor IA, tabelas com_*). A Central NÃO lê o banco do Vendedor IA: chama a API de
// serviço dele, com a mesma chave do Funil de Entrega.
//
//   GET {VENDEDORIA_URL}/api/integracoes/avanteza/busca?q=<texto>&limite=<1..10>&tipos=oportunidades,contatos,contratos
//   Authorization: Bearer {AVANTEZA_CRM_KEY}
//   200 → { oportunidades: Item[], contatos: Item[], contratos: Item[] }   Item = { id, titulo, detalhe?, caminho }
//
// Enquanto o Vendedor IA não tiver a rota (404), estiver sem a chave (503), recusar a chave (401) ou demorar, a busca do
// Comercial vira um aviso "Comercial indisponível" e o resto da paleta segue. Só aceita caminhos dentro de /comercial/
// (nada de link para fora). A chave e o texto buscado nunca vão para log nem para a mensagem de erro.
import { z } from "zod";
import { origemVendedoria } from "@/lib/comercial/zona";
import type { ItemBusca } from "./tipos";

export const CAMINHO_API = "/api/integracoes/avanteza/busca";
export const TIMEOUT_BUSCA_MS = 2_500;
export type TipoComercial = "oportunidades" | "contatos" | "contratos";
export const TIPOS_COMERCIAL: TipoComercial[] = ["oportunidades", "contatos", "contratos"];

export type ResultadoComercial =
  | { ok: true; grupos: Record<TipoComercial, ItemBusca[]> }
  | { ok: false; motivo: "nao-configurado" | "indisponivel" | "nao-autorizado" | "formato" | "timeout" | "rede" };

export interface ProvedorComercial {
  buscar(q: string, limite: number, tipos: TipoComercial[]): Promise<ResultadoComercial>;
}

const itemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  titulo: z.string().min(1).max(200),
  detalhe: z.string().max(200).nullish(),
  caminho: z.string().max(300),
});
const respostaSchema = z.object({
  oportunidades: z.array(itemSchema).optional().default([]),
  contatos: z.array(itemSchema).optional().default([]),
  contratos: z.array(itemSchema).optional().default([]),
});

/** Só caminhos relativos dentro da zona do Comercial (sem protocolo, sem //, sem ..). */
export function caminhoSeguro(c: string): boolean {
  return /^\/comercial\/[A-Za-z0-9\-._~/%?=&#+]*$/.test(c) && !c.includes("//") && !c.includes("..") && !c.includes("\\");
}

const ICONE: Record<TipoComercial, string> = { oportunidades: "funnel", contatos: "users", contratos: "doc" };

export function criarProvedorComercial(o: { baseUrl: string; chave: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ProvedorComercial {
  const base = o.baseUrl.replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  return {
    async buscar(q, limite, tipos) {
      const sp = new URLSearchParams({ q, limite: String(limite), tipos: tipos.join(",") });
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? TIMEOUT_BUSCA_MS);
      try {
        const res = await doFetch(`${base}${CAMINHO_API}?${sp}`, {
          method: "GET", headers: { Authorization: `Bearer ${o.chave}`, Accept: "application/json" }, signal: ctl.signal, cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) return { ok: false, motivo: "nao-autorizado" };
        if (res.status === 503) return { ok: false, motivo: "nao-configurado" };
        if (!res.ok) return { ok: false, motivo: "indisponivel" }; // 404 = rota ainda não existe no Vendedor IA
        const v = respostaSchema.safeParse(await res.json().catch(() => null));
        if (!v.success) return { ok: false, motivo: "formato" };
        const grupos = {} as Record<TipoComercial, ItemBusca[]>;
        for (const t of TIPOS_COMERCIAL) {
          grupos[t] = tipos.includes(t)
            ? v.data[t].filter((i) => caminhoSeguro(i.caminho)).slice(0, limite)
              .map((i) => ({ id: `${t}:${i.id}`, titulo: i.titulo, detalhe: i.detalhe ?? null, href: i.caminho, ext: true, icon: ICONE[t] }))
            : [];
        }
        return { ok: true, grupos };
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
        return { ok: false, motivo: timeout ? "timeout" : "rede" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Provedor a partir do ambiente. Sem AVANTEZA_CRM_KEY, responde "nao-configurado" sem chamar a rede. */
export function provedorComercialDoAmbiente(env: Record<string, string | undefined> = process.env): ProvedorComercial {
  const chave = env.AVANTEZA_CRM_KEY?.trim();
  if (!chave) return { buscar: async () => ({ ok: false, motivo: "nao-configurado" }) };
  return criarProvedorComercial({ baseUrl: origemVendedoria(env), chave });
}
