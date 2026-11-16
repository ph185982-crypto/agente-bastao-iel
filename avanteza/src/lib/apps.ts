// Registro dos aplicativos da Avanteza. A Central usa esta lista para montar o menu e para o login único.
// Os endereços vêm de variáveis de ambiente (para trocar *.vercel.app por subdomínios sem mexer no código).
export interface AppDef {
  id: string;
  name: string;
  tagline: string;
  /** Endereço base (sem barra final). Vazio = módulo interno desta aplicação. */
  url: string;
  /** Caminho do retorno do login único no aplicativo. */
  callback: string;
  internalPath?: string;
  group: "Operações" | "Comercial" | "Marketing" | "Financeiro" | "Institucional";
  external?: boolean; // site público: sem login
}

import { appUrl } from "@/lib/env";
import { zonaComercialLigada } from "@/lib/comercial/zona";

const env = (k: string, d: string) => (process.env[k] && process.env[k]!.length ? process.env[k]! : d).replace(/\/$/, "");

/**
 * Vendedor IA/Comercial: sob esta Central, em /comercial (reescrita; login único volta para /comercial/api/sso/callback).
 * APP_VENDAS_URL ainda vence (apague-a na Vercel se apontar para o domínio antigo); COMERCIAL_ZONA=0 volta ao antigo.
 */
function urlVendas(): string {
  return env("APP_VENDAS_URL", zonaComercialLigada() ? `${appUrl()}/comercial` : "https://nexo-vendedoria.vercel.app");
}

export function apps(): AppDef[] {
  return [
    { id: "marketplaces", name: "Marketplaces", tagline: "Contas de Mercado Livre, Shopee e TikTok Shop: alertas, aprovações e relatórios.", url: "", callback: "", internalPath: "/", group: "Operações" },
    { id: "entregas", name: "Funil de Entrega", tagline: "Quadro por etapa e pilar, renovações e modelos das entregas aos clientes (dados do CRM).", url: "", callback: "", internalPath: "/operacoes/entregas", group: "Operações" },
    { id: "crm", name: "CRM", tagline: "Funil, contatos, tarefas, agenda e propostas.", url: env("APP_CRM_URL", "https://nexo-crm-tawny.vercel.app"), callback: "/api/sso/callback", group: "Comercial" },
    { id: "vendas", name: "Vendedor IA", tagline: "Atendimento e prospecção no WhatsApp com IA.", url: urlVendas(), callback: "/api/sso/callback", group: "Comercial" },
    { id: "contratos", name: "Contratos", tagline: "Geração de contratos e assinatura digital.", url: env("APP_CONTRATOS_URL", "https://nexo-presenter.vercel.app"), callback: "/api/sso/callback", group: "Comercial" },
    { id: "conteudo", name: "Conteúdo", tagline: "Produção e publicação para Instagram e LinkedIn.", url: env("APP_CONTEUDO_URL", "https://agente-bastao-iel.vercel.app"), callback: "/api/sso/callback", group: "Marketing" },
    { id: "financeiro", name: "Financeiro", tagline: "Lançamentos, contas, contratos, DRE e metas da Avanteza (e a área pessoal do dono).", url: "", callback: "", internalPath: "/financeiro", group: "Financeiro" },
    { id: "site", name: "Site", tagline: "avanteza.com.br", url: env("APP_SITE_URL", "https://avanteza.com.br"), callback: "", group: "Institucional", external: true },
  ];
}

export const APP_IDS = ["marketplaces", "entregas", "crm", "vendas", "contratos", "conteudo", "financeiro"] as const;

/** Aplicativos que já aceitam o login único (os demais abrem com o login próprio até serem integrados). */
export function ssoEnabled(id: string): boolean {
  return (process.env.SSO_APPS ?? "").split(",").map((s) => s.trim()).includes(id);
}

export function getApp(id: string): AppDef | undefined {
  return apps().find((a) => a.id === id);
}

/** Para onde o cartão/menu de um app leva: módulo interno, login único (SSO) ou o endereço do app (login próprio). */
export function hrefDoApp(a: AppDef): string {
  if (a.external) return a.url;
  if (!a.url) return a.internalPath ?? "/";
  return ssoEnabled(a.id) ? `/sso/authorize?app=${a.id}` : a.url;
}
