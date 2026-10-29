// Acesso por código. Carrega ANTES de tudo: guarda o token, anexa em toda chamada
// /api e mostra a tela de código quando o servidor pede. O código nunca é
// guardado no navegador, só o token assinado (validade de 14 dias).
(function () {
  const KEY = 'pico_token';
  const lerToken = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const gravaToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* modo privado */ } };

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
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0A1B33;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Montserrat,system-ui,sans-serif';
    el.innerHTML = `
      <form style="width:100%;max-width:360px;background:#fff;border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:14px">
        <div style="font-size:22px;font-weight:800;color:#0A1B33">Pedro Destrava</div>
        <div style="font-size:14px;color:#5B6B82;line-height:1.4">Digite o código de acesso para abrir a ferramenta.</div>
        <input id="pico-code" type="password" autocomplete="current-password" inputmode="text" placeholder="Código de acesso"
          style="min-height:52px;border:1.5px solid #DCE3EE;border-radius:12px;padding:0 14px;font-size:16px;outline:none">
        <div id="pico-login-err" style="color:#FF3B30;font-size:13px;min-height:18px" role="alert">${msg || ''}</div>
        <button type="submit" style="min-height:52px;border:0;border-radius:14px;background:#0052FF;color:#fff;font-size:16px;font-weight:700">Entrar</button>
      </form>`;
    document.body.appendChild(el);
    const form = el.querySelector('form');
    const input = el.querySelector('#pico-code');
    input.focus();
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
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(24,25,29,.72);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,sans-serif';
    el.innerHTML = `
      <form style="width:100%;max-width:380px;background:#F6F5F0;border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:12px;color:#18191D">
        <div style="font-size:21px;font-weight:800">Crie seu código para publicar</div>
        <div style="font-size:14px;color:#686A73;line-height:1.45">O app está aberto: qualquer pessoa com o endereço poderia postar no seu Instagram. Crie um código só seu (mínimo 10 caracteres). A partir daí, aprovar já agenda e publica sozinho.</div>
        <input id="pico-novo" type="password" autocomplete="new-password" placeholder="Seu código (10+ caracteres)" minlength="10" maxlength="128"
          style="min-height:52px;border:1.5px solid #D8D6CE;border-radius:12px;padding:0 14px;font-size:16px;outline:none;background:#fff">
        <input id="pico-novo2" type="password" autocomplete="new-password" placeholder="Repita o código"
          style="min-height:52px;border:1.5px solid #D8D6CE;border-radius:12px;padding:0 14px;font-size:16px;outline:none;background:#fff">
        <div style="font-size:12px;color:#686A73">Guarde este código: ele vai ser pedido para abrir o app em outro celular ou navegador.</div>
        <div id="pico-login-err" style="color:#C62828;font-size:13px;min-height:18px" role="alert"></div>
        <button type="submit" style="min-height:52px;border:0;border-radius:14px;background:#2448FF;color:#fff;font-size:16px;font-weight:700">Criar código e liberar a publicação</button>
        <button type="button" id="pico-depois" style="min-height:44px;border:0;background:none;color:#686A73;font-size:14px">Agora não</button>
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
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0A1B33;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Montserrat,system-ui,sans-serif';
    el.innerHTML = `<div style="width:100%;max-width:380px;background:#fff;border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:12px;color:#0A1B33">
      <div style="font-size:20px;font-weight:800">Configuração necessária</div>
      <div style="font-size:14px;line-height:1.5;color:#3B4A60">Este endereço está sem código de acesso definido no servidor. Por segurança, pesquisa, geração e leitura de dados ficam bloqueadas até o código ser configurado.</div>
      <div style="font-size:13px;line-height:1.5;color:#5B6B82">Na Vercel: projeto → Settings → Environment Variables → <b>APP_ACCESS_CODE</b> (pelo menos 10 caracteres), no ambiente deste endereço. Depois, faça um novo deploy.</div>
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
      if (criado && s.estado === 'protegido') setTimeout(() => { const t = document.createElement('div'); t.setAttribute('role', 'status'); t.textContent = 'Código criado. Publicação liberada: é só aprovar.'; t.style.cssText = 'position:fixed;left:16px;right:16px;bottom:24px;z-index:9999;background:#18191D;color:#fff;border-radius:14px;padding:14px 16px;font:600 15px Inter,system-ui,sans-serif;text-align:center'; document.body.appendChild(t); setTimeout(() => t.remove(), 6000); }, 400);
      if (s.configured === false) naoConfigurado();
      else if (s.protected && !s.authenticated) pedirCodigo();
    })
    .catch(() => { window.__picoAuth = { protected: null }; });

  window.PicoAuth = { sair: () => { gravaToken(''); originalFetch('/api/auth/sair', { method: 'POST' }).finally(() => location.reload()); }, pedirCodigo, criarCodigo };
})();
