# Arquitetura da plataforma Avanteza

Uma entrada, um login, uma identidade visual — sem mover nem misturar os bancos de dados.

## Princípios
1. **Aplicativos independentes, identidade única.** Cada ferramenta continua sendo um projeto próprio na
   Vercel, com seu banco. Se uma cair, as outras continuam. O que é comum (login, usuários, marca) fica
   num lugar só.
2. **Nada de segredo compartilhado.** A Central assina; os aplicativos só conferem com a chave pública.
3. **Dados não se movem sem cópia conferida.** Migração de banco só com cópia, contagem tabela a tabela,
   troca em horário de baixo uso e o banco antigo guardado por 30 dias.
4. **Reversível por padrão.** Cada aplicativo mantém o login próprio como reserva até o login único
   estar provado em produção.

## Mapa

```
                         app.avanteza.com.br
                ┌───────────────────────────────────┐
                │  CENTRAL  (Avanteza ID)            │
                │  login · usuários · permissões     │
                │  menu de ferramentas · auditoria   │
                └───────┬───────────────────────────┘
        token ES256 (60 s, 1 app)  │  chave pública: /.well-known/jwks.json
   ┌──────────────┬───────────────┼────────────────┬─────────────────┐
   ▼              ▼               ▼                ▼                 ▼
Marketplaces     CRM         Vendedor IA       Contratos         Conteúdo
(módulo da     nexo-crm     nexo-vendedoria   nexo-presenter   agente-bastao-iel
 Central)                                                       (Pedro Destrava)
   │              │               │                │                 │
 Neon         Supabase         Supabase        sem banco           Neon + Blob
 avanteza     schema crm      schema public   (navegador)         pico_*
```

Site institucional (`avanteza.com.br`) e UFFIR (`uffir.com.br`) são estáticos, sem login.

## Login único (Avanteza ID)
1. O usuário abre qualquer ferramenta. Sem sessão local, ela redireciona para
   `app.avanteza.com.br/sso/authorize?app=<id>&return=<caminho>`.
2. A Central confere a sessão (ou pede login) e a permissão do usuário para aquele aplicativo.
3. A Central emite um JWT **ES256 válido por 60 segundos, para um único aplicativo** (`aud`) e redireciona
   para o endereço de retorno **registrado** do aplicativo (`/api/sso/callback?token=…`) — o destino nunca
   vem da URL, então não serve para redirecionar a sites de terceiros.
4. O aplicativo confere assinatura, emissor, destinatário e validade (`packages/avanteza-kit/avanteza-sso.js`),
   localiza o usuário pelo e-mail e cria a **sessão local dele** (o mecanismo que já existia).
5. Todo login único fica no log de auditoria da Central.

Papéis: **admin** (tudo; precisa constar em `ADMIN_EMAILS`), **member** (só os aplicativos marcados),
**reviewer** (somente leitura em Marketplaces). Gestão em `app.avanteza.com.br/usuarios`.

Funciona com qualquer domínio (hoje `*.vercel.app`). Quando os subdomínios existirem
(`crm.`, `vendas.`, `contratos.`, `conteudo.avanteza.com.br`), basta trocar as variáveis `APP_*_URL` na Central.

## Identidade visual única
`packages/avanteza-kit/tokens.css` é a fonte única: Marinho #0B1B33, Creme #F5F0E6, Areia #EAD9C2,
Laranja #FF6A1F; Manrope + Instrument Serif; sem sombras, sem degradês, bordas de 1px, laranja só para ação.
Cada aplicativo mapeia o próprio tema para esses tokens. Todos têm, no topo, o atalho de grade (2×2) que volta
para a Central.

## Bancos de dados
| Sistema | Onde está | Situação |
|---|---|---|
| Marketplaces / Central | Neon `avanteza-db` (schema `avanteza`) | fica |
| Conteúdo | Neon `pedro-destrava-db-2` + Blob `videos-pedro` | fica |
| Vendedor IA | Supabase `nexo-vendedoria`, schema `public` | fica; migrar para Neon depois, com cópia conferida |
| CRM | Supabase `nexo-vendedoria`, schema `crm` | idem |
| Contratos | sem banco (histórico no navegador) | ganhar histórico no servidor depois |

## Ordem de execução
1. Central + Avanteza ID + kit (feito).
2. Login único e tema em cada aplicativo, em prévia → teste → produção, um por vez.
3. Subdomínios `*.avanteza.com.br`.
4. Banco único na Vercel (Neon), um sistema por vez, com cópia conferida.
5. Painel da Central com os números de todas as ferramentas.

## Encerrados em 2026-11-15
Felyne (site) e PRF Estudo excluídos da Vercel; banco do PRF desligado no Supabase.
`nexos-paginas-api` e `dist` pausados (duplicados/abandonados).
