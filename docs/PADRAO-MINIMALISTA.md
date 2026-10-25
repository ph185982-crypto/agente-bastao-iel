# Padrão de carrossel "Pedro Destrava — Minimalista" (`pedro_minimalista_estrategico_v1`)

Todo carrossel NOVO sai neste padrão, por qualquer caminho: Radar (pesquisa diária, "Gerar carrossel", nova pauta por link/nome/texto, lote),
estúdio (Criar → Carrossel), mesa (link, pauta descoberta, "Gerar em lote"), esteira semanal e monitor de notícias em alta.

## O que mudou
- Entrada única: `backend/lib/radar/pauta.js` (ler → identificar → verificar → gerar, retomável; lote com estado e erro por item).
- Arte: `backend/lib/radar/arteMinimalista.js` (1080×1350, fundo #FFFFFF, margem 96 px, título 82→64 px, corpo 44→36 px, sem numeração;
  composições A foto+texto, B só texto, C produto recortado, D encerramento com a foto aprovada do Pedro). Cada render é medido.
- Método: `backend/lib/radar/metodo.js` (briefing completo, teste de valor, 3 ganchos pontuados, 5 a 7 telas com informação nova,
  relação com a anterior, fatos, evidências e briefing visual; revisão por IA com rodada de correção).
- Imagens: `carrossel2.atribuirImagensV1` escolhe entre candidatos, sem repetir foto; a cópia de trabalho sai sem EXIF/GPS e o original fica guardado.
- Exportação: PNGs numerados, `legenda.txt` (com créditos), `fontes-e-creditos.md`, `carrossel.json` (objeto completo), `ficha-de-fontes.json`.
- Rotas novas: `GET /api/radar/padrao`, `POST /api/radar/pautas`, `GET /api/radar/pautas[/:id]`, `POST /api/radar/pautas/:id/passo`,
  `POST /api/radar/lotes`, `GET /api/radar/lotes/:id`, `POST /api/radar/lotes/:id/passo`, `POST /api/radar/carrosseis/:id/converter`, `POST /api/radar/foto-pedro`.
- Criação pelos modelos antigos responde `409 PADRAO_V1`: `/api/carousels/generate*`, `/api/carousels/clonar`, `/api/studio/criar` (carrossel),
  `/api/content/copy` (carrossel), `gerar_carrossel` com `serie: 'ideias'` ou `template` antigo.

## Histórico
Nada existente é apagado nem convertido sozinho. Carrosséis antigos continuam legíveis, editáveis e exportáveis com o desenho original
(`arteMinimalistaLegado.js`, `arte2.js`). "Criar nova versão no padrão novo" gera uma versão NOVA a partir da mesma pesquisa; a antiga fica igual.

## Reversão técnica
No ambiente do servidor: `CARROSSEL_PADRAO=legado` e um novo deploy. As rotas e telas antigas de criação voltam; o que foi criado
no padrão novo continua guardado e legível. Para voltar ao padrão novo, remova a variável e faça deploy.

## Testes
- `node --test backend/lib/padraoMinimalista.test.js` (padrão novo, IA e páginas simuladas)
- `node tests/e2e/executar.js padraoTest` (celular 390×844)
- Os testes dos fluxos antigos rodam com a reversão ligada (provam que ela funciona).
