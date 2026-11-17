// Itens locais da paleta: páginas do menu (navegação rápida) e ações rápidas. Saem do MESMO menu por departamentos
// (menuEquipe), então respeitam os papéis do menu: Pessoal do Financeiro só para o dono, membro só com os apps liberados.
import type { Session } from "@/lib/session";
import { menuEquipe } from "@/lib/shell/menu";
import { podeAcoesDeEscrita, podeBuscar, podeImportarConversa } from "./acesso";
import type { ItemBusca } from "./tipos";

/** Páginas que a sessão enxerga no menu lateral (entradas dos departamentos + módulos), sem repetição. */
export function paginasDoMenu(sess: Session | null): ItemBusca[] {
  if (!podeBuscar(sess)) return [];
  const vistos = new Set<string>();
  const out: ItemBusca[] = [];
  const add = (i: ItemBusca) => { if (!vistos.has(i.href)) { vistos.add(i.href); out.push(i); } };
  for (const g of menuEquipe(sess)) {
    if (g.label && g.href) add({ id: `dep:${g.href}`, titulo: g.label, detalhe: "Departamento", href: g.href, icon: "grid" });
    for (const it of g.items) add({ id: `pag:${it.href}`, titulo: it.label, detalhe: g.label ?? null, href: it.href, ext: it.ext || undefined, icon: it.icon });
  }
  return out;
}

/** Ações rápidas: só as que a sessão pode executar (revisor não escreve). */
export function acoesRapidas(sess: Session | null): ItemBusca[] {
  if (!podeBuscar(sess)) return [];
  const out: ItemBusca[] = [];
  if (podeAcoesDeEscrita(sess)) {
    out.push({ id: "rapida:nova-acao", titulo: "Nova ação para cliente", detalhe: "Escolha o cliente e abra o plano", href: "/clientes/{cliente}?aba=plano#nova-acao", icon: "check", pedeCliente: true, termos: "criar tarefa plano entrega" });
    out.push({ id: "rapida:simular-contrato", titulo: "Simular contrato", detalhe: "Contrato assinado de teste (Onboarding)", href: "/operacoes/onboarding#simular", icon: "doc", termos: "assinado onboarding clicksign" });
  }
  if (podeImportarConversa(sess)) {
    out.push({ id: "rapida:importar-conversa", titulo: "Importar conversa", detalhe: "Conversa exportada do WhatsApp (Capturas)", href: "/operacoes/capturas#imp", icon: "chat", termos: "whatsapp captura exportada" });
  }
  return out;
}
