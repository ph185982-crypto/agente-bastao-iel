const fs = require('fs');
const path = require('path');
const { chromium: real } = require('playwright');
const SP = process.env.SP || path.join(__dirname, 'out');
fs.mkdirSync(path.join(SP, 'vendor'), { recursive: true });
for (const [pacote, arquivo] of [['react', 'react.production.min.js'], ['react-dom', 'react-dom.production.min.js'], ['@babel/standalone', 'babel.min.js']]) {
  const origem = pacote === '@babel/standalone' ? require.resolve('@babel/standalone/babel.min.js') : path.join(path.dirname(require.resolve(`${pacote}/package.json`)), 'umd', arquivo);
  fs.copyFileSync(origem, path.join(SP, 'vendor', arquivo));
}
const local = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
module.exports.chromium = {
  async launch(opts = {}) {
    const browser = await real.launch({ ...opts, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || real.executablePath() });
    const novo = browser.newContext.bind(browser);
    browser.newContext = async (opcoes) => {
      const ctx = await novo(opcoes);
      // As rotas específicas registradas pelos testes têm precedência.
      await ctx.route('**/*', r => local(r.request().url()) ? r.continue() : r.abort());
      return ctx;
    };
    return browser;
  },
};
