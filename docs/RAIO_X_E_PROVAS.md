# Raio-X do perfil e Provas do dia (27/11/2026)

Pedido do Pedro: "analise todos os posts, sem me agradar, e crie um mecanismo de conteúdo que engaje e traga seguidores".

## 1. Raio-X (Resultados → Crescimento → Raio-X)
- **Ler todos os posts agora**: o app lê da Meta, em passos de 50 posts (até 600), todas as métricas de cada post e a conta
  (alcance de seguidores × não seguidores, quem seguiu × quem saiu, demografia). Só leitura.
- O diagnóstico é feito por regras (`backend/lib/raioXAnalise.js`), sem IA: cada achado traz o número e o que fazer.
  Mediana, posts com mais de 72 h, grupo com menos de 5 posts marcado como "pouco".
- Tabelas: por linha de produção (frase, Por trás da marca, Quem é ele?, vídeo, fora da ferramenta), por formato, por tipo de
  abertura, por tema, por quantidade de posts no mesmo dia e mês a mês; melhores e piores posts; o que repetir e o que parar.
- **Copiar relatório**: texto compacto (sem link nem identificador de mídia) para colar numa conversa.
- Linha que rende abaixo do perfil ganha o botão **Pausar esta linha no piloto** (decisão do Pedro).

Limites: tema e abertura vêm das palavras da legenda (aproximação); a Meta não informa seguidores por Reel; métrica que a Meta
recusa aparece na lista "o que a Meta não entregou", nunca como zero.

### Leitura cifrada pelo GitHub (opcional, manual)
`.github/workflows/raio-x.yml` chama `GET /api/crescimento/raio-x` com o token OIDC do runner e imprime a resposta **cifrada**
com a chave pública informada ao disparar (o repositório é público: nada sai em texto aberto). Só o dono dispara, em
Actions → "Raio-X do perfil" → Run workflow.

## 2. Provas do dia (Resultados → Crescimento → Provas do dia)
O mecanismo de criação: toda ideia de vídeo parte de uma **prova de demanda** (`backend/lib/provas.js`):
1. aprovada por você (Estratégia criativa ou comentário que virou pauta);
2. conteúdo seu que rendeu acima do normal no Raio-X (novo episódio, outro ângulo);
3. tese que viralizou no mercado nos últimos 7 dias (quantas vezes passou a mediana da própria conta);
4. pergunta que a audiência repete.

- "Quero o roteiro desta" põe a ideia na frente da fila; o roteiro aparece na aba Vídeos com **"Por que este roteiro"**.
- Sem escolher nada, o motor já segue esta ordem: escolhidas → seus vencedores → virais.
- O roteirista recebe o que os números do perfil mostram (o que aparece entre os melhores, o que nunca aparece, quanto dos
  Reels sai antes de 3 segundos), só quando há amostra.
- **Reel de teste**: no vídeo pronto, "Publicar como Reel de teste" manda `trial_params` para a Meta: o vídeo vai primeiro só
  para quem não segue e é liberado aos seguidores se render (ou manualmente, no app do Instagram).
- **Plano de volume**: a tela mostra o que o piloto produz hoje e o plano recomendado (linha fraca no Raio-X sai; as outras
  ficam em 1 por dia; 3 roteiros de vídeo). Só é aplicado com o toque do Pedro.

Custo: nenhuma chamada de IA nova. Nada é publicado sem aprovação.
