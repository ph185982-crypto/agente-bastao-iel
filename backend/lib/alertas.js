// Alertas de operação por push: coisas que param a ferramenta sem ninguém ver. Um aviso por dia, de dia (nunca de madrugada),
// juntando o que houver: banco perto do limite, token da Meta inválido ou vencendo, relógio do piloto que ficou parado.
// Falha de publicação agendada e IA sem cota avisam na hora, pela própria rodada do piloto (backend/lib/top/piloto.js).
const LIMITE_BANCO_MB = () => Number(process.env.LIMITE_BANCO_MB) > 0 ? Number(process.env.LIMITE_BANCO_MB) : 512;
const DIAS_TOKEN = 7; const HORAS_PARADO = 4;

// Pura: recebe o que foi medido e devolve as frases de alerta (vazio = tudo certo).
function avaliar({ espaco = null, saude = null, ultimaRodadaEm = null, agora = Date.now() } = {}) {
  const out = [];
  if (espaco?.banco > 0) {
    const mb = Math.round(espaco.banco / 1048576); const pct = Math.round((mb / LIMITE_BANCO_MB()) * 100);
    if (pct >= 70) out.push(`Banco de dados em ${pct}% do limite gratuito (${mb} de ${LIMITE_BANCO_MB()} MB).`);
  }
  const tk = saude?.token;
  if (saude?.reconectar || tk?.valido === false) out.push('O acesso ao Instagram caiu: reconecte em Perfil → Conexões, senão nada é publicado.');
  else if (tk?.expira_em && !Number.isNaN(Date.parse(tk.expira_em))) {
    const dias = Math.floor((Date.parse(tk.expira_em) - agora) / 86400000);
    if (dias <= DIAS_TOKEN) out.push(dias <= 0 ? 'O acesso ao Instagram venceu: reconecte em Perfil → Conexões.' : `O acesso ao Instagram vence em ${dias} dia${dias === 1 ? '' : 's'}: renove em Perfil → Conexões.`);
  }
  if (ultimaRodadaEm && agora - Date.parse(ultimaRodadaEm) > HORAS_PARADO * 3600000) out.push(`O piloto ficou ${Math.round((agora - Date.parse(ultimaRodadaEm)) / 3600000)} h sem rodar (já voltou). Posts agendados nesse intervalo podem ter saído atrasados.`);
  return out;
}

// Mede e avisa. Cada medição falha em silêncio: alerta nunca derruba a rodada.
async function conferir({ agora = Date.now(), ultimaRodadaEm = null, deps = {} } = {}) {
  const a = deps.armazem || require('./armazem').armazem();
  const espaco = a?.arquivos?.espaco ? await a.arquivos.espaco().catch(() => null) : null;
  let saude = null; try { saude = await (deps.saude || (() => require('./publicador').saude()))(); } catch { /* sem leitura: não alerta */ }
  const frases = avaliar({ espaco, saude, ultimaRodadaEm, agora });
  if (frases.length) await (deps.notificar || ((o) => require('./push').notificar(o)))({ corpo: frases.join(' '), tag: 'alerta-operacao', url: '/?tab=ajustes' }).catch(() => {});
  return { frases, espaco_mb: espaco?.banco ? Math.round(espaco.banco / 1048576) : null };
}

module.exports = { avaliar, conferir, LIMITE_BANCO_MB };
