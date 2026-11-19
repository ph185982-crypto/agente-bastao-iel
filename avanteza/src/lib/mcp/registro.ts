// Registro de TODAS as ferramentas do conector (/api/mcp): as da Central (ferramentas.ts) e as de anúncios
// (marketplace e Meta Ads). A rota e os testes usam esta lista.
import { executarFerramenta, FERRAMENTAS, type Ator, type Deps, type Ferramenta } from "./ferramentas";
import { FERRAMENTAS_MARKETPLACE } from "./ferramentas-marketplace";
import { FERRAMENTAS_META } from "./ferramentas-meta";

export const TODAS_FERRAMENTAS: Ferramenta[] = [...FERRAMENTAS, ...FERRAMENTAS_MARKETPLACE, ...FERRAMENTAS_META];

export function executarQualquer(nome: string, ator: Ator, args: unknown, deps: Deps = {}): Promise<unknown> {
  return executarFerramenta(nome, ator, args, deps, TODAS_FERRAMENTAS);
}
