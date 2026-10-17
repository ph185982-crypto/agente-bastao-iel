# Testes no navegador (Playwright)

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
