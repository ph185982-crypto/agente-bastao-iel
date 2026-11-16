// Tela "Simular contrato assinado": em produção exige confirmação dupla (marcar + digitar a frase).
export const emProducao = () => process.env.VERCEL_ENV === "production";
export const FRASE_PRODUCAO = "SIMULAR EM PRODUCAO";
