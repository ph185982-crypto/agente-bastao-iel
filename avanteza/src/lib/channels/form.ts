// Leitura e validação dos formulários dos Canais (servidor): “Tráfego (anúncios) · Meta Ads” e “Mídias (Instagram)”.
// Sem efeitos colaterais; nunca registra token nem chave.
import { RESULTADO_PADRAO, type FonteAnuncios, type FonteInstagram } from "./types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export interface CamposAnuncios {
  adAccountId: string | null; campaignIds: string[]; campaignNameFilter: string | null; resultActionType: string; usarTokenPlataforma: boolean; token: string | null; adsSource: FonteAnuncios;
}
export interface CamposInstagram {
  igSource: FonteInstagram; igUserId: string | null; pageId: string | null; windsorAccountName: string | null; windsorKey: string | null;
}
export type CamposCanal = CamposAnuncios & CamposInstagram;

/** Seção de anúncios (Meta Ads). */
export function lerCamposAnuncios(fd: FormData): { erro: string } | { campos: CamposAnuncios } {
  let conta = str(fd, "ad_account_id").replace(/\s+/g, "");
  if (conta) {
    conta = conta.replace(/^act_/i, "");
    if (!/^\d{3,25}$/.test(conta)) return { erro: "Conta de anúncios: use só números (com ou sem o prefixo act_)." };
    conta = `act_${conta}`;
  }
  const campanhas = str(fd, "campaign_ids").split(/[\s,;]+/).filter(Boolean);
  if (campanhas.some((c) => !/^\d{3,25}$/.test(c))) return { erro: "Campanhas: informe só os IDs numéricos, separados por vírgula." };
  const nomeFiltro = str(fd, "campaign_name_filter").replace(/\s+/g, " ");
  if (nomeFiltro.length > 120) return { erro: "Filtro por nome: no máximo 120 caracteres." };
  const resultado = str(fd, "result_action_type") || RESULTADO_PADRAO;
  if (!/^[a-z0-9_.:\-]{3,100}$/i.test(resultado)) return { erro: "Tipo de resultado inválido." };
  const token = str(fd, "token").replace(/\s+/g, "");
  if (token && (token.length < 20 || token.length > 1000)) return { erro: "O token parece incompleto. Cole-o inteiro." };
  const pedida = str(fd, "ads_source");
  if (pedida && pedida !== "meta" && pedida !== "windsor" && pedida !== "none") return { erro: "Fonte de anúncios inválida." };
  const adsSource: FonteAnuncios = (pedida as FonteAnuncios) || (conta ? "meta" : "none");
  if ((adsSource === "meta" || adsSource === "windsor") && !conta) return { erro: `Informe a conta de anúncios para ler os anúncios ${adsSource === "windsor" ? "pelo Windsor.ai" : "pela Meta"} (ou escolha “Sem anúncios”).` };
  return { campos: { adAccountId: conta || null, campaignIds: [...new Set(campanhas)], campaignNameFilter: nomeFiltro || null, resultActionType: resultado, usarTokenPlataforma: fd.get("use_platform_token") === "on", token: adsSource === "meta" ? token || null : null, adsSource } };
}

/** Seção de Instagram (Windsor.ai ou Meta). */
export function lerCamposInstagram(fd: FormData): { erro: string } | { campos: CamposInstagram } {
  const ig = str(fd, "ig_user_id").replace(/\s+/g, "");
  if (ig && !/^\d{3,25}$/.test(ig)) return { erro: "ID do Instagram: só números." };
  const pagina = str(fd, "page_id").replace(/\s+/g, "");
  if (pagina && !/^\d{3,25}$/.test(pagina)) return { erro: "ID da Página: só números." };
  const pedida = str(fd, "ig_source");
  if (pedida && !["meta", "windsor", "none"].includes(pedida)) return { erro: "Fonte do Instagram inválida." };
  const igSource: FonteInstagram = (pedida as FonteInstagram) || (ig ? "meta" : "none");
  if (igSource === "meta" && !ig) return { erro: "Para ler o Instagram pela Meta, informe o ID do Instagram." };
  const nome = str(fd, "windsor_account_name").replace(/^@/, "");
  if (nome && !/^[\p{L}\p{N}_.\- ]{1,100}$/u.test(nome)) return { erro: "Nome da conta (account_name): use só letras, números, ponto, hífen e sublinhado." };
  const chave = str(fd, "windsor_key").replace(/\s+/g, "");
  if (chave && (chave.length < 10 || chave.length > 300)) return { erro: "A chave do Windsor.ai parece incompleta. Cole-a inteira." };
  return { campos: { igSource, igUserId: igSource === "meta" ? ig || null : null, pageId: igSource === "meta" ? pagina || null : null, windsorAccountName: igSource === "windsor" ? nome || null : null, windsorKey: igSource === "windsor" ? chave || null : null } };
}

/** Os dois blocos juntos (compatibilidade e testes). */
export function lerCamposCanal(fd: FormData): { erro: string } | { campos: CamposCanal } {
  const a = lerCamposAnuncios(fd);
  if ("erro" in a) return a;
  const i = lerCamposInstagram(fd);
  if ("erro" in i) return i;
  return { campos: { ...a.campos, ...i.campos } };
}
