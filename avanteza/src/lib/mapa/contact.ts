// Contato da Avanteza mostrado na tela Conta. Configurável por ambiente (sem inventar dados na base).
export function avantezaContact() {
  const e = (k: string) => (process.env[k] && process.env[k]!.trim()) || null;
  const wa = e("MAPA_CONTATO_WHATSAPP");
  const digits = wa ? wa.replace(/\D/g, "") : "";
  return {
    name: e("MAPA_CONTATO_NOME") ?? "Equipe Avanteza",
    email: e("MAPA_CONTATO_EMAIL"),
    whatsapp: wa,
    whatsappUrl: digits ? `https://wa.me/${digits.length <= 11 ? "55" + digits : digits}` : null,
  };
}
