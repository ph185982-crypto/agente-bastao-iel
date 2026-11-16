# Prompt para o Cowork — conectar a Meta de um cliente (somente leitura)

> Use este prompt no Cowork (navegador do Pedro, já logado no Meta Business e na Central Avanteza).
> Cliente deste prompt: **SHOWMAN** · conta de anúncios `act_605261696580859` · campanha **SHOW MAN | Assinatura R$69,90 | WhatsApp** (ID `120252388371430661`).
> Para outro cliente, troque o nome, a conta de anúncios e a campanha.
>
> **Mudança:** o **Instagram agora vem do Windsor.ai** (fonte independente, configurada na seção “Mídias (Instagram)” da aba Canais). O Cowork só precisa do token de **ANÚNCIOS** (Meta Ads): permissões **`ads_read`** e **`read_insights`**. Página e Instagram (`pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, IDs) passam a ser **opcionais**, só se o Instagram for lido pela Meta em vez do Windsor. Nos passos abaixo, ignore Página/Instagram se o Instagram do cliente já estiver no Windsor.ai.

---

Você vai preparar o acesso de **somente leitura** da Avanteza à conta de anúncios e ao Instagram do cliente SHOWMAN, para gerarmos relatórios e a evolução das mídias dele em tempo integral. Fale comigo em português. **Não altere nada** em campanhas, orçamentos, públicos, páginas ou perfis. Se alguma tela pedir uma ação que mude algo além do que está descrito abaixo, pare e me pergunte.

## Regra de ouro sobre o token
O token é uma senha. **Nunca** escreva o token no chat, em arquivos, em e-mails, em anotações ou em capturas de tela. Ele só pode ser colado **uma vez**, no formulário da Central descrito no passo 6. Depois de colar, limpe a área de transferência.

## Passo 1 — Usuário do sistema (Business Manager)
1. Abra https://business.facebook.com/settings e selecione o negócio que é dono da conta de anúncios `605261696580859`.
2. Vá em **Usuários → Usuários do sistema**. Se já existir um usuário do sistema de leitura para a Avanteza, use-o; senão, **Adicionar** um novo chamado `avanteza-leitura` com a função **Funcionário** (não Administrador).

## Passo 2 — Atribuir ativos (apenas os do SHOWMAN)
Para o usuário do sistema, clique em **Adicionar ativos** e atribua somente:
- **Contas de anúncios:** `605261696580859` com permissão **Gerenciar? NÃO.** Marque apenas **Visualizar desempenho** (ver relatórios).
- **Páginas:** a página do Facebook do SHOWMAN, com acesso de leitura (conteúdo e insights). Sem permissão de publicar nem de mensagens.
- **Contas do Instagram:** o perfil do SHOWMAN, com acesso de leitura a insights/conteúdo.
Se o Instagram não aparecer: ele precisa ser uma conta **profissional** (comercial ou criador) e estar **vinculado à Página** (Business Suite → Configurações → Contas vinculadas). Vincule e repita.

## Passo 3 — Gerar o token
1. Ainda no usuário do sistema, clique em **Gerar novo token**.
2. Escolha o app já existente da Avanteza.
3. Validade: **Nunca expira**.
4. Marque **somente** estas permissões: `ads_read` e `read_insights` (para anúncios). Opcionais, só se o Instagram for pela Meta: `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_manage_insights`. (Inclua `business_management` só se a lista de contas não aparecer sem ela.)
5. **Não marque** nenhuma permissão de escrita: nada de `ads_management`, `pages_manage_*`, `instagram_content_publish`, `whatsapp_*`, `pages_messaging`.
6. Gere e mantenha o token **só na tela**, sem copiar para lugar nenhum ainda.

## Passo 4 — Validar (Explorador da API do Graph, https://developers.facebook.com/tools/explorer)
Com o token gerado, confirme e **me diga só os resultados, sem mostrar o token**:
- `GET /me?fields=id,name`
- `GET /act_605261696580859?fields=name,account_status,currency,amount_spent`
- `GET /act_605261696580859/insights?date_preset=last_7d&fields=spend,impressions,clicks,actions`
- `GET /120252388371430661?fields=name,status,objective,effective_status`
- `GET /{id-da-pagina-showman}?fields=name,instagram_business_account` → anote o **ID da Página** e o **ID do Instagram** (`instagram_business_account.id`).
- `GET /{id-do-instagram}?fields=username,followers_count,media_count`
- `GET /{id-do-instagram}/insights?metric=reach,profile_views&period=day&metric_type=total_value`
Se algum retornar erro de permissão, diga **qual** e o que falta (ativo não atribuído ou permissão não marcada) e corrija no passo 2/3.

## Passo 5 — Me entregue o resumo (sem o token)
Responda com:
- ID da conta de anúncios, nome e status; moeda.
- ID e nome da campanha; objetivo; status.
- ID da Página do Facebook e ID do Instagram + @usuário.
- Lista das permissões do token e se cada teste do passo 4 passou.

## Passo 6 — Colar o token na Central (único lugar permitido)
1. Abra https://app.avanteza.com.br/clientes (login do Pedro), entre em **Showman** e clique na aba **Canais**. O formulário chama-se **Conectar Meta**.
2. Na seção **“Tráfego (anúncios) · Meta Ads”**, preencha os campos (o Instagram tem seção própria, “Mídias (Instagram) · Windsor.ai”, e não é preenchido aqui), com estes nomes exatos: **Conta de anúncios** `605261696580859` (com ou sem o `act_`); **Campanhas** `120252388371430661` (ou deixe em branco para todas); **Token** (campo de senha: cole aqui, uma única vez). Não mexa em “Opções avançadas”.
3. Clique em **Testar conexão (Meta Ads)**. O teste só lê (GET) e mostra, sem expor o token: token válido, permissões de leitura (e as que faltam), nome/status/moeda da conta de anúncios, acesso à campanha, Página e Instagram reconhecidos. Se o ID do Instagram estiver em branco e a Página tiver um Instagram vinculado, a tela sugere o ID. Resolva qualquer item “Falhou” antes de seguir.
4. Clique em **Salvar**. O token é guardado criptografado e nunca mais aparece na tela; só os 4 últimos caracteres ficam visíveis (“termina em ····”).
5. Na parte de cima da seção de anúncios, clique em **Atualizar anúncios agora**: ele coleta anúncios, criativos, Instagram e completa até 90 dias de histórico (leva alguns segundos). A mensagem verde “Coleta concluída: N registros gravados” indica que a primeira coleta trouxe dados.
6. Limpe a área de transferência. Não tire print dessa tela com o token.
7. Me diga o resultado do teste (quais permissões foram reconhecidas e quais faltam) e a mensagem do **Atualizar agora**.

## Se algo der errado
- Não tente contornar com permissões de escrita nem com tokens pessoais.
- Se o Instagram não for reconhecido, me diga o que a tela mostra e pare.
