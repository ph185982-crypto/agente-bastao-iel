# Conectar o Instagram (@pedro_destrava) para publicar

Este guia é para você fazer **sozinho**. **Nunca cole token, segredo do app ou chave de IA em chat, e-mail
ou mensagem.** Os valores entram só na Vercel (Settings → Environment Variables). Se algum valor já foi
colado em algum lugar, trate como vazado: gere outro e invalide o antigo (passo 9).

O app publica pelo **Instagram API com Facebook Login** (`graph.facebook.com`): precisa de uma
**conta Instagram profissional (Business ou Criador) ligada a uma Página do Facebook**. Fonte oficial:
developers.facebook.com → Instagram Platform → Content Publishing e Facebook Login (consultadas em 21/10/2026).

## O que a Meta exige (conferido na documentação)

- Permissões: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (e `pages_show_list`
  para listar suas Páginas). Se o seu acesso à Página vem do Business Manager, também `ads_management` e `ads_read`.
- Imagem do feed: **só JPEG** (o app converte e entrega JPEG). Carrossel: até **20** itens. Legenda: até
  **2.200** caracteres e **30** hashtags. Reel: MP4, 3 s a 15 min, até 300 MB, 9:16 recomendado.
- **Limite de publicações por API**: a própria documentação cita 100 por 24 h em um trecho e 50 em outro.
  Por isso o app **lê o limite na hora** (`content_publishing_limit`) e mostra em Ajustes → Conexões.
- Um post enviado por API **não pode ser despublicado pela API**. O app só publica depois da sua aprovação.
- Os exemplos da documentação usam a versão **v26.0** da Graph API (ajustável em `META_GRAPH_VERSION`).
- ⚠️ **Não consegui confirmar na documentação consultada** se um app em *modo de desenvolvimento* dispensa a
  *App Review* para publicar na sua própria conta. O que a Meta documenta: quem tem função no app consegue
  testar; para outras pessoas usarem, é preciso revisão e o modo Ativo. Para a sua conta, faça o teste do
  passo 7: se a Meta recusar por permissão, a mensagem aparece em português em Ajustes → Conexões e o
  caminho é pedir o acesso avançado na tela *App Review* do seu app.

## Passo a passo

1. **Confirme a conta.** No Instagram: Configurações → Tipo de conta → Profissional. Vincule à Página do
   Facebook (Configurações → Central de Contas / Página).
2. **Crie o app.** developers.facebook.com → Meus apps → Criar app → tipo *Empresa* (Business). Adicione os
   produtos de Instagram e *Login do Facebook para Empresas*. Anote o **ID do app** (`META_APP_ID`) e o
   **segredo do app** (`META_APP_SECRET`, em Configurações → Básico).
3. **Gere um token de usuário** no *Explorador da Graph API*, escolhendo o seu app e as permissões acima, e
   entrando com o Facebook que administra a Página. (Vale 1 hora.)
4. **Troque por um token longo** (≈ 60 dias). No seu computador, não no chat:
   ```
   curl "https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=TOKEN_CURTO"
   ```
5. **Pegue o token da Página e o id da Página.** Com o token longo:
   ```
   curl "https://graph.facebook.com/v26.0/me/accounts?access_token=TOKEN_LONGO"
   ```
   Na resposta, da sua Página copie `id` (**`META_PAGE_ID`**) e `access_token` (**`META_PAGE_ACCESS_TOKEN`**).
   Segundo a Meta, o token de Página obtido de um token longo **não tem data de expiração**, mas pode ser
   invalidado (senha trocada, acesso removido etc.).
6. **Pegue o id do Instagram** (`META_IG_USER_ID`):
   ```
   curl "https://graph.facebook.com/v26.0/PAGE_ID?fields=instagram_business_account&access_token=TOKEN_DA_PAGINA"
   ```
   O app confere que esse id é o de **@pedro_destrava** (`17841474524337634` na Graph API), vinculado à Página Pedro Destrava (`716013528269008`), conforme consulta à Meta em 22/10/2026. Se for outra conta, **nada é publicado**.
   O ID interno `74541076144` continua identificando os dados salvos e o perfil consultado pela RapidAPI; não deve ser usado em `META_IG_USER_ID` nem substituído no armazenamento.
7. **Coloque na Vercel** (Settings → Environment Variables; ambiente Preview agora, Production depois):

   | Variável | O que é |
   |---|---|
   | `META_APP_ID`, `META_APP_SECRET` | do app (passo 2) |
   | `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN` | passos 5 e 6 |
   | `PUBLISH_SECRET` | uma frase longa inventada por você; assina os links de imagem entregues à Meta |
   | `PUBLIC_BASE_URL` | o endereço público do app (ex.: `https://seu-app.vercel.app`), sem barra no fim |
   | `APP_ACCESS_CODE` | seu código de acesso (mín. 10 caracteres) — veja `docs/ACESSO.md` |
   | `DATABASE_URL` | do banco (Neon) — veja `docs/ARMAZENAMENTO.md`. **Sem banco não há publicação.** |
   | `CRON_SECRET` | opcional; a Vercel o envia ao cron diário que retoma publicações paradas |

   Depois faça um novo deploy. Abra **Ajustes → Conexões → Verificar agora**: deve aparecer
   *Instagram conectado: @pedro_destrava*, token válido e a cota de hoje.
8. **Teste com calma.** Em Ajustes ligue **Pausar publicações**, aprove um item (ele fica "aprovado", nada
   é enviado). Desligue a pausa e publique **um** item de teste.
9. **Se o token vazar ou expirar:** o app mostra o banner **"Reconecte o Instagram"**. Gere um token novo
   (passos 3 a 5), troque `META_PAGE_ACCESS_TOKEN` na Vercel e faça redeploy. Para invalidar um token
   vazado, remova o seu app em Facebook → Configurações → *Integrações empresariais* e gere tudo de novo, e
   considere redefinir o segredo do app (Configurações → Básico).

## O que o app faz (e não faz)

- Publica **só depois do seu toque em "Aprovar e publicar"**, e só a **versão aprovada** (o servidor confere o
  hash e roda de novo as regras de revisão). Nunca publica sozinho.
- Mantém o estado no servidor: se você fechar o app no meio, o item continua e é retomado ao reabrir (e
  pelo cron diário do plano Hobby da Vercel, que só roda 1 vez por dia).
- Duplo toque ou reenvio **não duplica** o post. Se a resposta da Meta se perder, o app procura o post nas
  mídias recentes antes de tentar de novo.
- **Reels:** a publicação de vídeo depende de um lugar público para guardar o MP4 (a Meta o baixa por URL);
  isso ainda não está contratado. Carrossel e imagem única funcionam sem armazenamento de arquivos.
