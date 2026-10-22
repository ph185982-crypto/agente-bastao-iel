# Cópia no servidor: configuração e operação

Em 22/10/2026, o banco **pedro-destrava-db** foi criado na integração Neon existente,
no plano **Free**, e conectado ao ambiente **Production** do projeto `agente-bastao-iel`.
O banco está separado do recurso usado pelo `nexo-backend`. Nenhum plano foi alterado.

O deploy `dpl_CxBHKrHi1WKJ2Mh7RZxd9GG4QCgH` está em produção e usa `DATABASE_URL`.
Foram conferidos pela API publicada: gravação e leitura com hash idêntico, recuperação
em outra sessão autenticada, histórico, conflito de revisão, concorrência e arquivos.
As credenciais ficam nas variáveis de ambiente do servidor; não estão neste repositório.

O **Preview continua sem banco conectado**. Os conteúdos que já estão no navegador
não são enviados pela configuração da infraestrutura: entre no app e use **Sincronizar agora**.
O navegador mantém sua cópia, e cada envio é conferido por leitura de volta.

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

## Uso após a ativação

1. Abra `https://agente-bastao-iel.vercel.app` e entre com o código de acesso existente.
2. Abra **Ajustes** → "Cópia no servidor". Clique **Sincronizar agora**.
   Cada conteúdo só é marcado "No servidor" depois de ser **lido de volta e o hash conferir**.
3. Em outro navegador/aparelho, entre com o código e sincronize para recuperar os conteúdos.
4. Continue exportando backups em Ajustes. O banco não substitui uma cópia independente.

## Migração e recuperação

- A migração **não apaga nada do navegador**. Se algo falhar, o conteúdo continua local e aparece como
  "Ainda não enviado".
- Conflito (dois aparelhos editaram): nenhuma versão é perdida; você escolhe qual vale e a outra fica
  guardada (snapshot local ou histórico do servidor).
- Perdeu o navegador: abra em outro, entre com o código — os conteúdos voltam do servidor.
- Perdeu o servidor: importe o arquivo de backup em Ajustes.
- Desligar: apague a variável `DATABASE_URL` e faça deploy; o app volta a funcionar só no navegador.
