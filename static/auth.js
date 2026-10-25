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

  // Descobre no carregamento se precisa de código.
  originalFetch('/api/auth/status', { headers: lerToken() ? { Authorization: `Bearer ${lerToken()}` } : {} })
    .then((r) => r.json())
    .then((s) => {
      window.__picoAuth = s;
      if (s.configured === false) naoConfigurado();
      else if (s.protected && !s.authenticated) pedirCodigo();
    })
    .catch(() => { window.__picoAuth = { protected: null }; });

  window.PicoAuth = { sair: () => { gravaToken(''); location.reload(); }, pedirCodigo };
})();
