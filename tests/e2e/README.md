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
