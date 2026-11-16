// Leitura e validação dos campos do formulário “Conectar Meta” (servidor). Sem efeitos colaterais; nunca registra o token.
import { RESULTADO_PADRAO } from "./types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export interface CamposCanal {
  adAccountId: string | null; campaignIds: string[]; igUserId: string | null; pageId: string | null; resultActionType: string;
  usarTokenPlataforma: boolean; token: string | null;
}
/** Valida e normaliza os campos do formulário. Devolve a mensagem de erro em pt-BR ou os campos limpos. */
export function lerCamposCanal(fd: FormData): { erro: string } | { campos: CamposCanal } {
  let conta = str(fd, "ad_account_id").replace(/\s+/g, "");
  if (conta) {
    conta = conta.replace(/^act_/i, "");
    if (!/^\d{3,25}$/.test(conta)) return { erro: "Conta de anúncios: use só números (com ou sem o prefixo act_)." };
    conta = `act_${conta}`;
  }
  const campanhas = str(fd, "campaign_ids").split(/[\s,;]+/).filter(Boolean);
  if (campanhas.some((c) => !/^\d{3,25}$/.test(c))) return { erro: "Campanhas: informe só os IDs numéricos, separados por vírgula." };
  const ig = str(fd, "ig_user_id").replace(/\s+/g, "");
  if (ig && !/^\d{3,25}$/.test(ig)) return { erro: "ID do Instagram: só números." };
  const pagina = str(fd, "page_id").replace(/\s+/g, "");
  if (pagina && !/^\d{3,25}$/.test(pagina)) return { erro: "ID da Página: só números." };
  const resultado = str(fd, "result_action_type") || RESULTADO_PADRAO;
  if (!/^[a-z0-9_.:\-]{3,100}$/i.test(resultado)) return { erro: "Tipo de resultado inválido." };
  const token = str(fd, "token").replace(/\s+/g, "");
  if (token && (token.length < 20 || token.length > 1000)) return { erro: "O token parece incompleto. Cole-o inteiro." };
  return { campos: { adAccountId: conta || null, campaignIds: [...new Set(campanhas)], igUserId: ig || null, pageId: pagina || null, resultActionType: resultado, usarTokenPlataforma: fd.get("use_platform_token") === "on", token: token || null } };
}

