# Testes no navegador (Playwright)

## Execução local automatizada

```sh
npm ci
npx playwright install chromium
npm run test:e2e
# Ou apenas uma suíte:
npm run test:e2e -- mesaBTest
```

O executor cria servidores locais nas portas 3995–3999, limpa credenciais herdadas,
usa respostas simuladas e bloqueia chamadas externas. Dependências do navegador
são servidas de cópias locais em `tests/e2e/out/vendor`. Não usa uma chave real.
O caminho do Chromium vem do Playwright; opcionalmente defina
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` para uma instalação já disponível.

**O executor usa o driver de armazenamento em memória** nas suítes Central, lote
e persistência. Cada suíte recebe um armazenamento novo. Esse modo verifica a
integração, mas não durabilidade após reiniciar o servidor nem o driver PostgreSQL.
Os cenários sem banco continuam sem cópia no servidor.

Neste ambiente de entrega, a execução visual foi bloqueada pelo sistema antes de
abrir o navegador (`socket() failed: Operation not permitted`). As suítes visuais
precisam ser executadas em um ambiente que permita iniciar o Chromium.

## Execução manual com PostgreSQL

As instruções abaixo descrevem os servidores necessários para validar o driver
PostgreSQL real. Use um banco **novo de teste** para cada arquivo e não conecte
uma base de produção. Não defina `TESTE_MEMORIA` nesse modo.

Cobrem a Mesa de trabalho de ponta a ponta. A IA e a leitura de matérias são simuladas
(`mesaBTest.js`); arte, regras de revisão, persistência local e exportação são as reais.

```
node backend/server.js &                      # porta 3990
node <proxy estático 4800 → 3990> &           # serve static/ e repassa /api
SP=/caminho/com/vendor node tests/e2e/mesaBTest.js
```
`SP/vendor` precisa de `react.production.min.js`, `react-dom.production.min.js` e `babel.min.js`
(o app antigo os busca em unpkg; o teste os serve localmente).
Os testes unitários ficam em `backend/lib/*.test.js` (`node --test backend/lib/*.test.js`).

## Persistência e aba fechada (`persistenciaTest.js`)

Usa o servidor REAL da aplicação com a IA SIMULADA (`servidorTeste.js`, que substitui só a
chamada ao modelo e conta quantas vezes ela aconteceu):

```
createdb pico_e2e
PORT=3996 TESTE_PORT=3995 DATABASE_URL=postgres://…/pico_e2e node tests/e2e/servidorTeste.js &
PORT=3998 TESTE_PORT=3997 node tests/e2e/servidorTeste.js &          # sem banco
SP=/caminho/com/vendor node tests/e2e/persistenciaTest.js
```
Testes do banco nos unitários: `PICO_TEST_PG=postgres://… node --test backend/lib/armazem.test.js`.

## Central de aprovação, publicação e lote (`centralTest.js`, `loteTest.js`)

Rodam contra o servidor real da aplicação (Postgres), IA simulada e **Meta simulada**
(`GRAPH_FALSA=1`, `backend/lib/graphFalsa.js`). Nada é publicado no Instagram de verdade.
Use um banco novo para cada arquivo (o segundo veria os conteúdos do primeiro):

```
GRAPH_FALSA=1 GRAPH_PORT=3999 PORT=3996 TESTE_PORT=3995 DATABASE_URL=postgres://…/pico_e2e ATRASO_MS=200 node tests/e2e/servidorTeste.js &
SP=/caminho/com/vendor node tests/e2e/centralTest.js
```
