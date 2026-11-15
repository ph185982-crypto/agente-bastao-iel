Você vai configurar, no meu navegador, os serviços externos do **Avanteza**, o sistema da minha consultoria que gerencia contas de clientes no Mercado Livre, Shopee e TikTok Shop. O sistema já está no ar em https://avanteza.vercel.app. Outro agente cuida do código; sua parte é só o que exige login nos painéis.

## Regras (siga sempre)
1. **Nunca escreva no chat, em arquivos ou em notas o valor de senhas, chaves secretas ou tokens.** Copie cada segredo direto do painel de origem e cole direto no campo da Vercel.
2. Quando um site pedir login, código por SMS/e-mail, captcha ou aceite de termos, pare e me peça para fazer. Não crie senhas por conta própria.
3. Não altere nada que não esteja nesta lista: outros apps, outros registros de DNS, outros projetos da Vercel, planos ou pagamentos.
4. Se um passo estiver bloqueado (por exemplo, cadastro aguardando aprovação), anote o motivo e siga para o próximo.
5. No fim, me entregue o relatório do último bloco.

## Como cadastrar uma variável na Vercel
Abra https://vercel.com → time "ph185982-crypto's projects" → projeto **avanteza** → Settings → Environment Variables → Add.
- Ambientes: marque **Production** e **Preview**.
- Segredos (chaves, secrets, keys): marque **Sensitive**.
- Valores comuns (IDs, e-mails): deixe sem Sensitive.
- Se a variável já existir, edite o valor; não crie outra com o mesmo nome.
- Não faça redeploy. O outro agente cuida disso.

---

## 1. Mercado Livre (prioridade máxima)
Acesse https://developers.mercadolivre.com.br/devcenter e abra o app **Avanteza** (Client ID `6409718634983655`). Na edição do app:
1. **URI de redirect:** `https://avanteza.vercel.app/api/auth/mercadolivre/callback`. Mantenha também `https://app.avanteza.com.br/api/auth/mercadolivre/callback`, se o campo aceitar mais de uma.
2. **URL de retorno de notificações:** `https://avanteza.vercel.app/api/webhooks/mercadolivre`
3. **Tópicos:** marque `orders_v2`, `questions`, `items` e `messages`. Se houver, marque também `shipments` e `payments`.
4. Veja se o **PKCE** está ligado no app. Se estiver, crie na Vercel a variável `ML_USE_PKCE` com valor `true`.
5. Salve.
6. Copie a **Secret Key** do app e cadastre na Vercel como `ML_CLIENT_SECRET` (Sensitive).

## 2. Domínio app.avanteza.com.br (Registro.br)
Acesse https://registro.br → domínio **avanteza.com.br** → DNS → Editar zona.
1. Se o domínio usar o DNS do Registro.br, adicione:
   - Tipo `CNAME`
   - Nome `app`
   - Valor `c32d288d8f55f9c9.vercel-dns-017.com.`
2. Se o DNS estiver em outro provedor (por exemplo Cloudflare ou Hostinger), crie o mesmo CNAME lá e me diga qual é o provedor.
3. Não mexa em nenhum outro registro nem nos servidores DNS.

## 3. Chave de IA (Anthropic)
1. Acesse https://console.anthropic.com → API Keys → crie uma chave chamada `avanteza`.
2. Cadastre na Vercel como `ANTHROPIC_API_KEY` (Sensitive).
3. Em Billing, veja se há crédito ou forma de pagamento. Só me informe; não compre nada.

## 4. Alertas por e-mail (Resend), se der tempo
1. Acesse https://resend.com. Se for criar conta, peça para eu fazer o login.
2. Em Domains, adicione `avanteza.com.br`.
3. Crie no DNS do Registro.br os registros que o Resend mostrar (normalmente TXT/MX no subdomínio `send`, mais um TXT DKIM). São adições; não apague nada.
4. Clique em Verify.
5. Crie uma API Key chamada `avanteza` → cadastre na Vercel como `RESEND_API_KEY` (Sensitive).
6. Cadastre também:
   - `ALERT_EMAIL_FROM` = `Avanteza <alertas@avanteza.com.br>`
   - `ALERT_EMAIL_TO` = o e-mail onde eu quero receber os alertas (pergunte para mim).

## 5. Shopee (Shopee Open Platform)
1. Acesse https://open.shopee.com e veja o status do meu cadastro de desenvolvedor.
2. **Se ainda estiver em análise:** anote o que falta (documentos, pendências) e pule para o bloco 6.
3. **Se estiver aprovado:**
   1. Crie ou abra um app para a Avanteza, do tipo para sistemas de vendedor/ERP. Prefira o tipo que permite autorizar lojas de terceiros (meus clientes).
   2. **Redirect URL / domínio de redirect:** `https://avanteza.vercel.app/api/auth/shopee/callback`
   3. **Push (Live Push / Push Mechanism):** URL `https://avanteza.vercel.app/api/webhooks/shopee`. Ative o push de mudança de status de pedido (order status).
   4. Peça ou ative o acesso **Live** (produção), além do Test.
   5. Cadastre na Vercel:
      - `SHOPEE_PARTNER_ID`, o número do Partner ID (sem Sensitive).
      - `SHOPEE_PARTNER_KEY`, a Partner Key **de produção (Live)** (Sensitive).

## 6. TikTok Shop (Partner Center)
1. Acesse https://partner.tiktokshop.com. Se não houver conta de desenvolvedor/parceiro, peça para eu fazer o login e o cadastro (a empresa é a Avanteza Consultoria; os documentos ficam comigo).
2. Crie um **App** (ou serviço) para a Avanteza:
   - **Região de mercado:** Brasil. Se pedir "US" ou "Global/Rest of World", escolha a que inclui o Brasil.
   - **Categoria:** sistema de gestão para vendedores (ERP/ferramenta de seller).
   - **Redirect URL:** `https://avanteza.vercel.app/api/auth/tiktok/callback`
   - **Permissões/escopos de API:** autorização de lojas (shop/authorization), produtos (leitura e edição), preço e estoque (inventory), pedidos (leitura).
   - **Webhook URL:** `https://avanteza.vercel.app/api/webhooks/tiktok`. Assine os eventos de mudança de status de pedido e de mudança de status de produto.
3. Envie o app para aprovação, se for exigido.
4. Cadastre na Vercel:
   - `TIKTOK_APP_KEY` (sem Sensitive)
   - `TIKTOK_APP_SECRET` (Sensitive)
   - `TIKTOK_SERVICE_ID`: é o número que aparece em `service_id=` no **link de autorização do vendedor** (seller authorization link) do app (sem Sensitive).
5. Se ainda estiver em análise, anote o status e o que falta.

---

## Relatório final (me entregue assim, sem nenhum valor secreto)
| Item | Status (feito / pendente / bloqueado) | Observação |
|---|---|---|
| ML: redirect, notificações e tópicos | | PKCE ligado? |
| ML_CLIENT_SECRET na Vercel | | |
| CNAME app no DNS | | provedor do DNS |
| ANTHROPIC_API_KEY na Vercel | | tem crédito? |
| Resend + 3 variáveis | | domínio verificado? |
| Shopee: status do cadastro, app, URLs | | |
| SHOPEE_PARTNER_ID / KEY na Vercel | | Live ou Test? |
| TikTok: conta, app, URLs, escopos, webhooks | | status da aprovação |
| TIKTOK_APP_KEY / SECRET / SERVICE_ID na Vercel | | |

No final, liste os nomes das variáveis que você cadastrou ou alterou na Vercel (só os nomes).
