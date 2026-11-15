// Acesso ao app. Carrega ANTES de tudo: guarda o token, anexa em toda chamada
// /api e mostra a tela de acesso quando o servidor pede. O código nunca é
// guardado no navegador, só o token assinado (validade de 14 dias).
// Entrada principal: login único "Avanteza ID" (a Central autentica e /api/sso/callback devolve o token
// no fragmento #sso=...). O código de acesso continua como alternativa de reserva.
(function () {
  // Aparência das telas de acesso (identidade Avanteza: marinho, creme, areia, laranja; sem sombra, borda de 1px, raio 6px).
  const FONTE = "Manrope,'Manrope PD',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const FUNDO = `position:fixed;inset:0;z-index:9999;background:#0B1B33;display:flex;align-items:center;justify-content:center;padding:24px;font-family:${FONTE}`;
  const CARTAO = 'width:100%;max-width:380px;background:#fff;border:1px solid #EAD9C2;border-radius:6px;padding:24px;display:flex;flex-direction:column;gap:12px;color:#0B1B33';
  const CAMPO = 'min-height:48px;border:1px solid #EAD9C2;border-radius:6px;padding:0 12px;font:inherit;font-size:16px;color:#0B1B33;background:#fff;outline-color:#FF6A1F';
  const BOTAO = 'min-height:48px;display:flex;align-items:center;justify-content:center;border-radius:50px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none';
  const BOTAO_ACAO = `${BOTAO};border:1px solid #FF6A1F;background:#FF6A1F;color:#fff`;
  const BOTAO_CONTORNO = `${BOTAO};border:1px solid #EAD9C2;background:#fff;color:#0B1B33`;
  const MARCA = '<div style="font-size:22px;font-weight:800;letter-spacing:-.045em;line-height:1">avanteza<span style="display:inline-block;width:.2em;height:.2em;background:#FF6A1F;margin-left:.06em"></span></div>';
  const ERROS_SSO = { invalido: 'O acesso pela Avanteza não foi aceito. Tente de novo.', central: 'A Central Avanteza não respondeu. Tente de novo ou use o código.', config: 'Este endereço ainda não está configurado para receber acessos.', servidor: 'Não foi possível abrir a sessão. Tente de novo.' };

  const KEY = 'pico_token';
  const lerToken = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const gravaToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* modo privado */ } };

  // Volta do login único: o token chega no fragmento (nunca em query string); guarda e limpa o endereço.
  let erroSso = '';
  (function lerFragmento() {
    const m = /^#sso(_erro)?=([^&]*)$/.exec(location.hash || '');
    if (!m) return;
    let valor = ''; try { valor = decodeURIComponent(m[2]); } catch { /* fragmento malformado */ }
    if (m[1]) erroSso = ERROS_SSO[valor] || ERROS_SSO.invalido;
    else if (/^[\w-]+\.[\w-]+$/.test(valor)) gravaToken(valor);
    try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
  })();

  const originalFetch = window.fetch.bind(window);
  let mostrando = false;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const ehApi = url.startsWith('/api/') || url.startsWith(`${location.origin}/api/`);
    if (!ehApi) return originalFetch(input, init);
    const token = lerToken();
    const opts = { ...(init || {}) };
    if (token) {
      const h = new Headers(opts.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
      if (!h.has('Authorization')) h.set('Authorization', `Bearer ${token}`);
      opts.headers = h;
    }
    return originalFetch(input, opts).then((res) => {
      if (res.status === 401 && !/\/api\/auth\//.test(url)) res.clone().json().then((d) => { if (d.code === 'AUTH_REQUIRED' && window.__picoAuth?.protected !== false) pedirCodigo(); }).catch(() => {});
      if (res.status === 403) res.clone().json().then((d) => { if (d.code === 'ACESSO_ABERTO') criarCodigo(); }).catch(() => {});
      if (res.status === 503) res.clone().json().then((d) => { if (d.code === 'ACCESS_NOT_CONFIGURED') naoConfigurado(); }).catch(() => {});
      return res;
    });
  };

  function pedirCodigo(msg) {
    if (mostrando) return;
    mostrando = true;
    const el = document.createElement('div');
    el.id = 'pico-login';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = FUNDO;
    const volta = encodeURIComponent(location.pathname + location.search);
    el.innerHTML = `
      <form style="${CARTAO}">
        ${MARCA}
        <div style="font-size:20px;font-weight:800;letter-spacing:-.025em;margin-top:6px">Pedro Destrava <span class="br">conteúdo</span></div>
        <div style="font-size:14px;color:#64748B;line-height:1.45">Entre com a sua conta Avanteza para abrir a ferramenta.</div>
        <a id="pico-sso" href="/api/sso/entrar?return=${volta}" style="${BOTAO_ACAO}">Entrar com Avanteza</a>
        <div style="display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;color:#64748B;margin-top:6px"><span style="flex:1;height:1px;background:#EAD9C2"></span>ou use o código de acesso<span style="flex:1;height:1px;background:#EAD9C2"></span></div>
        <input id="pico-code" type="password" autocomplete="current-password" inputmode="text" placeholder="Código de acesso" aria-label="Código de acesso"
          style="${CAMPO}">
        <div id="pico-login-err" style="color:#DC2626;font-size:13px;min-height:18px" role="alert">${msg || erroSso || ''}</div>
        <button type="submit" style="${BOTAO_CONTORNO}">Entrar com código</button>
      </form>`;
    document.body.appendChild(el);
    const form = el.querySelector('form');
    const input = el.querySelector('#pico-code');
    el.querySelector('#pico-sso').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = el.querySelector('#pico-login-err');
      err.textContent = '';
      try {
        const r = await originalFetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { err.textContent = d.error || 'Não foi possível entrar.'; return; }
        if (d.token) gravaToken(d.token);
        location.reload();
      } catch { err.textContent = 'Sem conexão com o servidor. Tente de novo.'; }
    });
  }

  // App aberto ao público: o Pedro cria o código aqui mesmo (fica no servidor como hash) e o app fecha.
  function criarCodigo() {
    if (mostrando) return;
    mostrando = true;
    const el = document.createElement('div');
    el.id = 'pico-login';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = FUNDO.replace('background:#0B1B33', 'background:rgba(11,27,51,.78)');
    el.innerHTML = `
      <form style="${CARTAO}">
        <div style="font-size:20px;font-weight:800;letter-spacing:-.025em">Crie seu código para publicar</div>
        <div style="font-size:14px;color:#64748B;line-height:1.45">O app está aberto: qualquer pessoa com o endereço poderia postar no seu Instagram. Crie um código só seu (mínimo 10 caracteres). A partir daí, aprovar já agenda e publica sozinho.</div>
        <input id="pico-novo" type="password" autocomplete="new-password" placeholder="Seu código (10+ caracteres)" minlength="10" maxlength="128"
          style="${CAMPO}">
        <input id="pico-novo2" type="password" autocomplete="new-password" placeholder="Repita o código"
          style="${CAMPO}">
        <div style="font-size:12px;color:#64748B">Guarde este código: ele vai ser pedido para abrir o app em outro celular ou navegador.</div>
        <div id="pico-login-err" style="color:#DC2626;font-size:13px;min-height:18px" role="alert"></div>
        <button type="submit" style="${BOTAO_ACAO}">Criar código e liberar a publicação</button>
        <button type="button" id="pico-depois" style="min-height:44px;border:0;background:none;color:#64748B;font:inherit;font-size:14px;cursor:pointer">Agora não</button>
      </form>`;
    document.body.appendChild(el);
    const err = el.querySelector('#pico-login-err');
    el.querySelector('#pico-novo').focus();
    el.querySelector('#pico-depois').addEventListener('click', () => { el.remove(); mostrando = false; });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = el.querySelector('#pico-novo').value; const b = el.querySelector('#pico-novo2').value;
      if (a.trim().length < 10) { err.textContent = 'Use pelo menos 10 caracteres.'; return; }
      if (a !== b) { err.textContent = 'Os dois códigos não são iguais.'; return; }
      try {
        const r = await originalFetch('/api/auth/definir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: a }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { err.textContent = d.error || 'Não foi possível criar o código.'; return; }
        if (d.token) gravaToken(d.token);
        try { sessionStorage.setItem('pico_codigo_criado', '1'); } catch { /* modo privado */ }
        location.reload();
      } catch { err.textContent = 'Sem conexão com o servidor. Tente de novo.'; }
    });
  }

  function naoConfigurado() {
    if (mostrando) return;
    mostrando = true;
    const el = document.createElement('div');
    el.id = 'pico-login';
    el.setAttribute('role', 'alertdialog');
    el.style.cssText = FUNDO;
    el.innerHTML = `<div style="${CARTAO}">
      ${MARCA}
      <div style="font-size:20px;font-weight:800;letter-spacing:-.025em;margin-top:6px">Configuração necessária</div>
      <div style="font-size:14px;line-height:1.5">Este endereço está sem código de acesso definido no servidor. Por segurança, pesquisa, geração e leitura de dados ficam bloqueadas até o código ser configurado.</div>
      <div style="font-size:13px;line-height:1.5;color:#64748B">Na Vercel: projeto → Settings → Environment Variables → <b>APP_ACCESS_CODE</b> (pelo menos 10 caracteres), no ambiente deste endereço. Depois, faça um novo deploy.</div>
    </div>`;
    document.body.appendChild(el);
  }

  // Imagens da prévia não levam o cabeçalho: com o token em mãos, pede o cookie de leitura (HttpOnly) ao servidor.
  if (lerToken()) originalFetch('/api/auth/cookie', { method: 'POST', headers: { Authorization: `Bearer ${lerToken()}` } })
    .then(() => document.querySelectorAll('img[src^="/api/"]').forEach((i) => { if (i.complete && !i.naturalWidth) i.src = i.src; }))
    .catch(() => {});

  // Descobre no carregamento se precisa de código.
  originalFetch('/api/auth/status', { headers: lerToken() ? { Authorization: `Bearer ${lerToken()}` } : {} })
    .then((r) => r.json())
    .then((s) => {
      window.__picoAuth = s;
      let criado = false; try { criado = sessionStorage.getItem('pico_codigo_criado') === '1'; sessionStorage.removeItem('pico_codigo_criado'); } catch { /* modo privado */ }
      if (criado && s.estado === 'protegido') setTimeout(() => { const t = document.createElement('div'); t.setAttribute('role', 'status'); t.textContent = 'Código criado. Publicação liberada: é só aprovar.'; t.style.cssText = `position:fixed;left:16px;right:16px;bottom:24px;z-index:9999;background:#0B1B33;color:#F5F0E6;border-left:4px solid #FF6A1F;border-radius:6px;padding:14px 16px;font:600 15px ${FONTE};text-align:center`; document.body.appendChild(t); setTimeout(() => t.remove(), 6000); }, 400);
      if (s.configured === false) naoConfigurado();
      else if (s.protected && !s.authenticated) pedirCodigo(erroSso);
    })
    .catch(() => { window.__picoAuth = { protected: null }; });

  window.PicoAuth = { sair: () => { gravaToken(''); originalFetch('/api/auth/sair', { method: 'POST' }).finally(() => location.reload()); }, pedirCodigo, criarCodigo };
})();
