# Monitor de notícias em alta

## O que ele faz

1. **Lê** os feeds dos veículos e agrupa o mesmo acontecimento.
2. **Separa o que está em alta**: o mesmo fato coberto por pelo menos N veículos diferentes (padrão 3) dentro da janela (padrão 12 h).
   É um sinal de **cobertura**, não de audiência: a tela diz isso.
3. **Tria** pela mesma regra da busca de pautas (prioridade mínima, política neutra, tema já usado, temas bloqueados).
4. **Te avisa** (uma notificação por rodada) e **já manda montar o roteiro** do que passou, até o teto diário (padrão 3).
5. **Para no roteiro.** Você abre o app, lê o texto (slides, legenda, chamada) e toca em **Aprovar roteiro e gerar carrossel**,
   **Outro roteiro** ou **Descartar**.
6. Depois de aprovado, a ferramenta escolhe as fotos, desenha o carrossel e te avisa de novo.
7. Você confere o carrossel e toca em **Aprovar e publicar**. Só aí algo vai ao Instagram (respeitando "Pausar publicações").

Nada é publicado, nem o carrossel é gerado, sem o seu toque.

## Como ligar

Vem **ligado** por padrão, mas só roda com banco de dados e chave de IA no servidor. Para desligar ou ajustar:
Ajustes → Perfil → Configurações → **Monitor de notícias em alta**. Cada rodada usa IA (triagem) e cada roteiro usa o pipeline de texto,
então defina o teto de roteiros por dia. "Buscar o que está em alta agora" roda uma rodada na hora.

Precisa de: banco de dados no servidor (para lembrar o que já avisou), chave de IA, e para o aviso no celular as chaves VAPID e o app
na Tela de Início (`docs/META_SETUP.md` e `docs/ARMAZENAMENTO.md`).

## Quando ele roda

- **App aberto:** a cada 10 s o app confere; se a última rodada passou do intervalo (padrão 30 min), dispara uma. É o que funciona hoje, sem configurar nada.
- **App fechado:** precisa de um agendador chamando `POST /api/monitor/tick` com `Authorization: Bearer <CRON_SECRET>`.
  O plano Hobby da Vercel só permite cron **diário**, então não serve para isso. Opções gratuitas:
  - **GitHub Actions** (`.github/workflows/monitor.yml`, a cada 30 min). Atenção: o GitHub só executa agendamentos de arquivos que estão na
    **branch principal**, então ele só começa a rodar depois que este arquivo for para a `main`. Configure a variável `MONITOR_URL`
    (endereço de produção) e o secret `CRON_SECRET`. Em repositório privado o plano gratuito dá 2.000 minutos por mês; 30 em 30 minutos
    gasta cerca de 1.500.
  - Um serviço de agendamento gratuito (ex.: cron-job.org) chamando a mesma URL com o cabeçalho acima.
  Prévias da Vercel ficam atrás de autenticação e não servem como `MONITOR_URL`.

## Limites e custos

- Ligado, cada rodada faz **uma** chamada de IA (triagem de até 14 pautas) e cada roteiro criado faz o pipeline de texto
  (várias chamadas). O teto diário e o limite do estúdio (10 conteúdos por dia, 5 em preparação) seguram o consumo.
  A cascata de IA começa pelos provedores gratuitos; se houver chave paga configurada ela pode entrar no fim da fila.
- "Em alta" não é audiência: dois ou três veículos copiando a mesma agência contam como veículos diferentes.
- Se um assunto já saiu no seu perfil nos últimos 21 dias (inclui os posts lidos na aba Resultados), ele não volta.
