// O mcp-handler cria um setInterval de limpeza no nível do módulo (sem unref): em produção não importa, mas no teste
// prenderia o processo. Importado ANTES da rota do MCP: todo setInterval vira unref.
const original = globalThis.setInterval;
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const t = original(...args);
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}) as typeof setInterval;
export {};
