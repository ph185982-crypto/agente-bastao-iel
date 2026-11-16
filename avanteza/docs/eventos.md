# Barramento de eventos da Central

Liga os módulos sem acoplamento: quem emite manda um evento para a Central; a Central grava (idempotente pelo `id`) e um
consumidor processa com retentativa e backoff. Código em `src/lib/eventos/*`.

## Entrada: `POST /api/eventos`

- `Authorization: Bearer <AVANTEZA_EVENTS_KEY>` — sem a variável na Central: **503**; chave errada: **401** (comparação em
  tempo constante). `Content-Type: application/json` (senão **415**), corpo até 256 KB.
- Respostas: **202** `{ id, duplicado: false, status }` (recebido; a Central já tenta processar na hora e devolve
  `processado` ou `pendente`), **200** `{ id, duplicado: true, status }` (mesmo `id` já recebido: nada é gravado de novo),
  **400** envelope/payload inválido (com `detalhes`), **422** tipo desconhecido.
- **Reenviar é seguro**: o mesmo fato tem sempre o mesmo `id`. Em timeout/5xx, o emissor reenvia o MESMO evento.

Envelope comum:

```json
{ "id": "<tipo>:<chave do fato>", "tipo": "contrato.assinado", "origem": "comercial", "ocorrido_em": "2026-11-16T13:00:00-03:00", "payload": { } }
```

`id`: até 200 caracteres, só letras, números e `. : @ _ -`. `ocorrido_em`: ISO 8601 com fuso (ou `AAAA-MM-DD`).

## Consumidor

- Tabela `avanteza.eventos` (`status` pendente | processado | falhou, `tentativas`, `proxima_tentativa_em`, `erro`, `resultado`).
- Processa na hora (dentro da própria requisição) e no cron `GET /api/cron/eventos` (Vercel Cron `7,37 * * * *`, e também
  dentro do `tick`), um evento por vez com reserva de 10 min (`for update skip locked`).
- Falha ou pendência (ex.: Financeiro fora do ar) → nova tentativa em 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h…; depois de
  **8 tentativas** vira `falhou` e o administrador recebe uma notificação. Em **Operações → Onboarding** o admin vê cada
  contrato, as pendências e o botão **Reprocessar agora** (zera as tentativas).
- Todo handler é **idempotente**: rodar o mesmo evento duas vezes não duplica nada.

## `contrato.assinado` (Comercial → Central)

Emitido pelo módulo de Contratos quando o envelope do ClickSign fica totalmente assinado.

```json
{
  "id": "contrato.assinado:<envelopeId>",
  "tipo": "contrato.assinado",
  "origem": "comercial",
  "ocorrido_em": "2026-11-16T13:00:00-03:00",
  "payload": {
    "contratoId": "ctr_123",
    "envelopeId": "a1b2c3d4-...",
    "razaoSocial": "Ladies Moda Comércio Ltda",
    "nomeFantasia": "Ladies",
    "cnpj": "11.222.333/0001-81",
    "representante": "Carla Souza",
    "emailCliente": "carla@ladies.com.br",
    "telefoneCliente": "+55 62 99999-0000",
    "modelo": "Prestação de serviços",
    "plano": "Essencial",
    "servicos": ["marketplace", "trafego", "midias"],
    "valorMensal": 3000,
    "duracaoMeses": 12,
    "inicioEm": "2026-11-17",
    "vencimentoDia": 10,
    "oportunidadeId": "opp_9",
    "leadId": "lead_7",
    "pdfUrl": "https://..."
  }
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id` | sim | exatamente `contrato.assinado:` + `envelopeId` (senão 400) |
| `contratoId`, `envelopeId`, `razaoSocial`, `modelo` | sim | texto; `envelopeId` só `[A-Za-z0-9_.@-]` |
| `servicos` | não (padrão `[]`) | slugs do `service_catalog`: `marketplace`, `trafego`, `midias-sociais`… Aceita os apelidos `midias`/`midia`/`social` → `midias-sociais`, `marketplaces` → `marketplace`, `trafego-pago`/`ads` → `trafego`. Slug desconhecido não trava (vai para `resultado.servicosDesconhecidos`). |
| `valorMensal` | não | número > 0 (reais). Sem ele, nada é lançado no Financeiro. |
| `duracaoMeses` | não | 1–120; sem ele, contrato por prazo indeterminado. |
| `inicioEm` | não | `AAAA-MM-DD`; padrão: dia de `ocorrido_em`. |
| `vencimentoDia` | não | 1–31 (dia inexistente no mês vira o último). |
| `pdfUrl` | não | `https://` |
| `simulado` | não | só a tela "Simular contrato assinado" manda; `true` = não lança receita. |

### O que o onboarding faz (idempotente, estado em `avanteza.onboardings`)

1. **Cliente**: casa por CNPJ (só dígitos); depois por nome normalizado (sem acento, caixa, pontuação e sufixos Ltda/ME/EIRELI/S/A)
   do nome fantasia ou da razão social — nunca casa com cliente que tem **outro** CNPJ; mais de um com o mesmo nome → falha
   explicada (o admin corrige e reprocessa). Sem casamento: cria (nome fantasia, slug único, tipo pelos serviços, início,
   contato, CNPJ).
2. **Serviços** (`client_services`): os contratados + Onboarding, com início, fim (início + duração − 1 dia), contrato e a
   mensalidade dividida igualmente entre os serviços vendidos. Já existentes ficam como estão.
3. **Plano de 12 meses** (se o cliente ainda não tem) e **Kickoff em D+2** da assinatura (reaproveita o Kickoff do plano;
   no tipo "ambos" fica um só).
4. **Playbooks**: gerador do Motor (`aplicarPlaybooks`), idempotente pela `recurrence_key`.
5. **Acesso ao Mapa**: usuário `client` com o `emailCliente` e senha gerada — só o hash bcrypt fica no banco; o texto fica
   **cifrado** (AES-256-GCM, `ENCRYPTION_KEY`) numa notificação ao admin e é revelado **uma única vez** (depois a cifra é
   apagada). E-mail que já é de cliente: só vincula a empresa. Sem e-mail ou e-mail da equipe: notificação pedindo o acesso.
   Nada é enviado por e-mail.
6. **Receita recorrente** no Financeiro do Vendedor IA (`POST …/financeiro/receitas?escopo=empresa`, modo `recorrente`,
   descrição com a marca `[ref:<envelopeId>]`). Antes de lançar, procura a marca nos contratos existentes — resposta perdida
   numa tentativa anterior não duplica. Indisponível → pendência e o evento volta para a fila.
7. **Auditoria** (`audit_log`, sem e-mail, senha ou valores sensíveis) e **notificações**: "Contrato assinado", "Cliente
   novo", "Acesso ao Mapa criado".

### Teste sem ClickSign

Operações → Onboarding → **Simular contrato assinado** (só administrador). Em produção (`VERCEL_ENV=production`) exige marcar
a confirmação e digitar `SIMULAR EM PRODUCAO`. Por padrão a simulação não lança receita.

```bash
curl -X POST https://app.avanteza.com.br/api/eventos -H "Authorization: Bearer $AVANTEZA_EVENTS_KEY" \
  -H "Content-Type: application/json" -d @contrato.json
```

## Notificações (`avanteza.notificacoes`)

Sino no AppShell da equipe (`GET/POST /api/notificacoes`, sessão obrigatória): lista, marcar como lida (por pessoa) e
revelar a senha inicial (uma vez, só admin). Destinos: `admin` ou `equipe`. Tipos: `contrato_assinado`, `cliente_novo`,
`acesso_cliente`, `captura`, `evento_falhou`.

## Capturas (Inbox de combinados) — APIs do Max

Todas com `Authorization: Bearer <AVANTEZA_CAPTURE_KEY>` (503 sem a variável, 401 chave errada). Cliente pelo nome
(sem acento/caixa; trecho do nome vale se só um bater) ou id; **ambíguo → 409 `{ candidatos: [...] }`**.

| Rota | Uso |
|---|---|
| `POST /api/capturas` | texto/transcrição/legenda + cliente → captura e ações (já existia) |
| `GET /api/capturas/pendencias?cliente=Ladies` | `{ cliente, total, atrasadas, doCliente, acoes: [{ id, titulo, prazo, status, responsavel, atrasada }] }` (até 25: atrasadas, sem prazo, bloqueadas e próximos 30 dias) |
| `POST /api/capturas/concluir` | `{ cliente, acao }` ou `{ cliente, acaoId }` → `{ concluida: { id, titulo } }`; ação ambígua → **409 `{ opcoes }`**; nenhuma parecida → 404 |
| `POST /api/capturas/importar?cliente=…&arquivo=…` | corpo = `.txt`/`.zip` cru (até 4 MB). Sem `cliente`, usa o cliente lembrado da conversa (senão 400). |

Importação de conversa exportada: `src/lib/capturas/*` (leitor Android/iOS, zip, blocos de 7 dias/12 mil caracteres),
deduplicação por mensagem em `captura_mensagens` (hash de autor + data/hora + texto), conversa → cliente lembrado em
`captura_conversas`. Áudios do `.zip` são transcritos só com `OPENAI_API_KEY` (opcional, `TRANSCRIPTION_MODEL`, padrão
`whisper-1`); sem ela entram como "[áudio não transcrito]".
