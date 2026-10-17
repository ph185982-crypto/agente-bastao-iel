// Identidade da conta, FIXA no código. Variável de ambiente não muda o @ nem o ID:
// um erro de configuração não pode imprimir outro @ nem ler outra conta.
const ACCOUNT = Object.freeze({
  username: 'pedro_destrava',
  handle: '@pedro_destrava',
  ig_id: '74541076144',
  nome: 'Pedro Martins',
  verified: false, // a conta não é verificada: nenhum selo pode ser desenhado
});
module.exports = { ACCOUNT };
