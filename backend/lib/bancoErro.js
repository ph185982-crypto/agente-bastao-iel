// O Neon gratuito bloqueia o banco inteiro (leitura e escrita) quando a cota do mês acaba: o erro vem em inglês ("exceeded the quota").
// Esta tradução evita mostrar o texto cru na tela e diz o que fazer.
const MSG = 'O banco de dados (Neon) atingiu a cota gratuita do mês e está bloqueado. Abra Vercel → Storage → Neon → Billing/Usage para ver o limite; ele volta quando a cota renova ou se o plano for ampliado. Seus dados não foram apagados.';
const ehCotaDoBanco = (e) => String(e?.code) === '53000' || /exceeded the (compute|data transfer|storage)?\s*quota|project size limit/i.test(String(e?.message || ''));
module.exports = { MSG, ehCotaDoBanco, traduzir: (e) => (ehCotaDoBanco(e) ? Object.assign(new Error(MSG), { status: 503, code: 'BANCO_COTA' }) : e) };
