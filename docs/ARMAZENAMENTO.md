# Cópia no servidor: proposta e passos

Hoje o preview roda **sem** cópia no servidor: a única cópia do trabalho está no navegador
(o app avisa com o selo "Só neste navegador"). O código para o servidor já está pronto e
testado contra PostgreSQL real; falta só conectar o serviço — o que depende da sua aprovação.

## O que guardar e onde

| O quê | Onde (recomendado) | Por quê |
|---|---|---|
| Conteúdo estruturado, versões, histórico, resultado das etapas de IA | **Neon Postgres** (Marketplace da Vercel) | Banco relacional com controle de revisão: um aparelho não sobrescreve o outro; guarda as 30 revisões anteriores de cada conteúdo |
| Fotos, encerramento aprovado, ZIPs exportados | **Por enquanto, no mesmo banco** (até 8 MB por arquivo). Quando passar de ~500 MB: **Cloudflare R2** | Começa com um serviço só; R2 dá 10 GB grátis e não cobra saída, mas exige conta e configuração manual |
| Backup | **Arquivo baixado por você** (Ajustes → Baixar backup) + histórico de revisões no banco | O "restore" de 6 h do Neon gratuito não é backup; um backup precisa ficar fora do serviço principal |

## Limites e preços (páginas oficiais lidas em 17/10/2026; confira antes de contratar)

- **Neon Free**: 1 GB por projeto, 100 CU-hora/mês, 5 GB de transferência; o banco "dorme" após 5 min
  sem uso (a primeira chamada depois disso demora mais); restauração de até 6 h. Se estourar, suspende
  sem apagar. Plano pago (Launch) é por uso (US$ 0,106/CU-h; US$ 0,35/GB-mês). Fonte: neon.com/pricing.
- **Cloudflare R2** (quando necessário): 10 GB-mês grátis, 1 milhão de operações de escrita e 10 milhões
  de leitura por mês, sem custo de saída; depois US$ 0,015/GB-mês. Fonte: developers.cloudflare.com/r2/pricing.
- Volume estimado do perfil: ~1 a 1,5 GB por ano somando conteúdos e imagens.
- **Atenção**: o plano Hobby da Vercel é descrito como "uso pessoal, não comercial". Se o perfil for uso
  comercial, isso precisa ser avaliado por você (não mudei plano nenhum).

## Passos (feitos por você ou com a sua autorização)

1. Vercel → projeto `agente-bastao-iel` → **Storage** → **Create** → **Neon (Postgres)** → plano **Free** →
   conecte ao projeto marcando **Preview** (e Production só quando for promover). A Vercel cria a
   variável `DATABASE_URL` sozinha.
2. Faça um novo deploy da branch (ou peça para eu fazer).
3. Abra o app → **Ajustes** → "Cópia no servidor" deve mostrar **Conectada**. Clique **Sincronizar agora**.
   Cada conteúdo só é marcado "No servidor" depois de ser **lido de volta e o hash conferir**.
4. Teste em outro navegador/aparelho: entre com o código e veja o conteúdo aparecer.

## Migração e recuperação

- A migração **não apaga nada do navegador**. Se algo falhar, o conteúdo continua local e aparece como
  "Ainda não enviado".
- Conflito (dois aparelhos editaram): nenhuma versão é perdida; você escolhe qual vale e a outra fica
  guardada (snapshot local ou histórico do servidor).
- Perdeu o navegador: abra em outro, entre com o código — os conteúdos voltam do servidor.
- Perdeu o servidor: importe o arquivo de backup em Ajustes.
- Desligar: apague a variável `DATABASE_URL` e faça deploy; o app volta a funcionar só no navegador.
