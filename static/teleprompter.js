// Teleprompter de tela cheia: câmera frontal, roteiro rolando por cima, contagem 3-2-1, gravação com
// MediaRecorder e envio para a edição pelo mesmo caminho da aba Vídeos (window.Videos.enviarArquivo).
// Pensado para iOS Safari e Android Chrome: playsinline, preview mudo e espelhado por CSS (o arquivo não é espelhado),
// pedidos de câmera com "ideal" (nunca "exact"). Nada aqui publica: o vídeo só entra na fila de edição.
(function () {
  'use strict';
  const T = {
    aberto: false, el: null, ctx: null, stream: null, rec: null, pedacos: [], mime: '', facing: 'user',
    roteiro: '', roteiro_id: null, titulo: '', estilo: 'hormozi',
    velocidade: 40, tamanho: 34, rolando: false, pos: 0, raf: null, ultimo: 0,
    estado: 'preparando', // preparando | pronto | contagem | gravando | previa | enviando | enviado | erro_camera
    inicio: 0, cronoTimer: null, blob: null, urlPrevia: null, wake: null, erro: '', editando: false, upload: null,
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ESTILOS = [['hormozi', 'Hormozi'], ['beast', 'Beast'], ['caixa', 'Caixa']];
  const q = (s) => T.el && T.el.querySelector(s);
  const toast = (m) => { if (T.ctx && T.ctx.toast) T.ctx.toast(m); else console.log('[teleprompter]', m); };
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  const MIMES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const escolherMime = () => (window.MediaRecorder && MediaRecorder.isTypeSupported ? MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) : '') || '';
  const suportaGravacao = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

  // ── Estrutura (montada uma vez; o estado muda por classes e textos, para o <video> não ser recriado) ──
  function montar() {
    const el = document.createElement('div');
    el.className = 'tp'; el.id = 'tp-overlay'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Teleprompter e câmera');
    el.innerHTML = `
      <video id="tp-cam" class="tp-cam espelho" autoplay muted playsinline></video>
      <div class="tp-previa" hidden><video id="tp-video-previa" controls playsinline preload="metadata"></video></div>
      <div class="tp-topo">
        <button type="button" class="tp-icone" data-tp="fechar" aria-label="Fechar o teleprompter">✕</button>
        <div class="tp-titulo"><b id="tp-titulo-texto"></b><span id="tp-estado-texto">Preparando a câmera…</span></div>
        <span class="tp-crono" id="tp-crono" aria-live="off"><i aria-hidden="true"></i>00:00</span>
      </div>
      <div class="tp-roteiro" id="tp-roteiro" role="button" tabindex="0" aria-label="Roteiro. Toque para pausar ou continuar a rolagem">
        <div class="tp-texto" id="tp-texto"></div>
        <div class="tp-pausado" id="tp-pausado" hidden>Pausado · toque para continuar</div>
      </div>
      <div class="tp-contagem" id="tp-contagem" hidden aria-live="assertive"><b>3</b></div>
      <div class="tp-ajustes" id="tp-ajustes">
        <label>Velocidade <output id="tp-vel-out">40</output> px/s<input type="range" id="tp-vel" min="20" max="80" step="1" value="40" aria-label="Velocidade do roteiro, de 20 a 80 pixels por segundo"></label>
        <label>Letra <output id="tp-tam-out">34</output> px<input type="range" id="tp-tam" min="22" max="64" step="1" value="34" aria-label="Tamanho da letra do roteiro"></label>
      </div>
      <div class="tp-editor" id="tp-editor" hidden>
        <label for="tp-roteiro-edit">Roteiro</label>
        <textarea id="tp-roteiro-edit" rows="8" placeholder="Cole ou escreva aqui o que você vai falar. Um parágrafo por ideia."></textarea>
        <div class="tp-linha"><button type="button" class="tp-btn" data-tp="salvar-roteiro">Usar este roteiro</button><button type="button" class="tp-btn fantasma" data-tp="fechar-editor">Cancelar</button></div>
      </div>
      <div class="tp-erro" id="tp-erro" hidden role="alert"></div>
      <div class="tp-rodape" id="tp-rodape">
        <div class="tp-linha" id="tp-acoes-pre">
          <button type="button" class="tp-btn fantasma" data-tp="editar" aria-label="Editar o roteiro antes de gravar">Editar roteiro</button>
          <button type="button" class="tp-btn fantasma" data-tp="virar" aria-label="Alternar entre câmera frontal e traseira">Virar câmera</button>
        </div>
        <button type="button" class="tp-rec" id="tp-rec" data-tp="gravar" aria-label="Começar a gravar"><i aria-hidden="true"></i><span>Gravar</span></button>
        <div class="tp-pos" id="tp-pos" hidden>
          <div class="tp-estilos" role="group" aria-label="Estilo das legendas">${ESTILOS.map(([k, r]) => `<button type="button" class="tp-estilo ${k}" data-tp="estilo" data-estilo="${k}" aria-pressed="${k === 'hormozi'}">${r}</button>`).join('')}</div>
          <div class="tp-barra" id="tp-barra" hidden role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
          <p class="tp-meta" id="tp-envio-texto"></p>
          <div class="tp-linha">
            <button type="button" class="tp-btn fantasma" data-tp="regravar">Regravar</button>
            <button type="button" class="tp-btn" data-tp="enviar" id="tp-enviar">Enviar para edição</button>
          </div>
        </div>
        <div class="tp-fallback" id="tp-fallback" hidden>
          <p>Grave com a câmera do celular e envie o arquivo aqui. O roteiro continua na tela para você ler.</p>
          <label class="tp-btn">Gravar ou escolher da galeria<input type="file" id="tp-arquivo" accept="video/*" capture="user" hidden></label>
        </div>
      </div>`;
    document.body.appendChild(el); T.el = el;
    el.addEventListener('click', aoClicar);
    el.addEventListener('input', aoAjustar);
    el.addEventListener('change', aoMudar);
    el.addEventListener('keydown', aoTeclar);
    q('#tp-roteiro').addEventListener('click', () => { if (['pronto', 'gravando', 'contagem'].includes(T.estado)) alternarRolagem(); });
    q('#tp-roteiro').addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); alternarRolagem(); } });
    document.body.classList.add('tp-aberto');
  }
  function aplicarTexto() {
    const t = q('#tp-texto'); if (!t) return;
    const pars = String(T.roteiro || '').split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
    t.innerHTML = pars.length ? pars.map((p) => `<p>${esc(p)}</p>`).join('') : '<p class="tp-sem">Sem roteiro. Toque em “Editar roteiro” para escrever, ou grave de improviso.</p>';
    t.style.fontSize = `${T.tamanho}px`; T.pos = 0; t.style.transform = 'translateY(0px)';
    const tt = q('#tp-titulo-texto'); if (tt) tt.textContent = T.titulo || 'Gravar com roteiro';
  }
  function setEstado(e, texto) {
    T.estado = e; T.el.dataset.estado = e;
    const s = q('#tp-estado-texto'); if (s && texto != null) s.textContent = texto;
    const gravando = e === 'gravando' || e === 'contagem'; const previa = ['previa', 'enviando', 'enviado'].includes(e);
    q('.tp-previa').hidden = !previa; q('#tp-cam').hidden = previa; q('#tp-pos').hidden = !previa; q('#tp-rec').hidden = previa || e === 'erro_camera';
    q('#tp-acoes-pre').hidden = gravando || previa || e === 'erro_camera'; q('#tp-ajustes').hidden = previa || e === 'erro_camera';
    q('#tp-roteiro').hidden = previa; q('#tp-fallback').hidden = e !== 'erro_camera';
    const rec = q('#tp-rec'); rec.classList.toggle('on', e === 'gravando'); rec.setAttribute('aria-label', e === 'gravando' ? 'Parar a gravação' : 'Começar a gravar'); rec.querySelector('span').textContent = e === 'gravando' ? 'Parar' : e === 'contagem' ? '…' : 'Gravar'; rec.disabled = e === 'contagem' || e === 'preparando';
    q('#tp-crono').classList.toggle('on', e === 'gravando');
    q('#tp-enviar').disabled = e === 'enviando' || e === 'enviado';
    q('#tp-enviar').textContent = e === 'enviando' ? 'Enviando…' : e === 'enviado' ? 'Enviado ✓' : 'Enviar para edição';
    q('#tp-barra').hidden = e !== 'enviando';
  }
  function mostrarErro(msg) { const el = q('#tp-erro'); if (!el) return; el.hidden = !msg; el.textContent = msg || ''; T.erro = msg || ''; }

  // ── Câmera ──────────────────────────────────────────────────────────────────
  async function ligarCamera() {
    pararStream();
    if (!suportaGravacao()) {
      setEstado('erro_camera', 'Este navegador não grava vídeo');
      mostrarErro(!navigator.mediaDevices ? 'Este navegador não dá acesso à câmera (no iPhone, use o Safari 14.5 ou mais novo, ou abra o app pela Tela de Início).' : 'Este navegador não grava vídeo pela web. Grave com a câmera do celular e envie o arquivo abaixo.');
      return;
    }
    setEstado('preparando', 'Preparando a câmera…'); mostrarErro('');
    const pedido = { video: { facingMode: T.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    try {
      T.stream = await navigator.mediaDevices.getUserMedia(pedido);
    } catch (e1) {
      try { T.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: T.facing }, audio: true }); }
      catch (e) {
        const n = e && e.name;
        const msg = n === 'NotAllowedError' || n === 'SecurityError' ? 'Câmera negada. Permita câmera e microfone para este site (no iPhone: Ajustes › Safari › Câmera/Microfone) e toque em “Virar câmera” para tentar de novo.'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'Nenhuma câmera encontrada neste aparelho.'
          : n === 'NotReadableError' ? 'A câmera está em uso por outro app. Feche-o e tente de novo.'
          : `Não consegui abrir a câmera (${e && e.message ? e.message : n || 'erro'}).`;
        setEstado('erro_camera', 'Sem câmera'); mostrarErro(msg); q('#tp-acoes-pre').hidden = false; return;
      }
    }
    const cam = q('#tp-cam'); cam.srcObject = T.stream; cam.classList.toggle('espelho', T.facing === 'user');
    try { await cam.play(); } catch { /* autoplay mudo costuma passar; se não, o usuário toca */ }
    T.mime = escolherMime();
    setEstado('pronto', T.mime ? `Pronto · ${/mp4/.test(T.mime) ? 'MP4' : 'WebM'}` : 'Pronto');
    if (!T.mime && !window.MediaRecorder) { setEstado('erro_camera', 'Sem gravação'); mostrarErro('Este navegador mostra a câmera mas não grava (MediaRecorder ausente). Use o botão abaixo para gravar com a câmera do celular.'); }
  }
  function pararStream() { if (T.stream) { T.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* já parou */ } }); T.stream = null; } }

  // ── Rolagem do roteiro ──────────────────────────────────────────────────────
  function passo(ts) {
    if (!T.rolando) { T.raf = null; return; }
    const dt = T.ultimo ? Math.min(0.1, (ts - T.ultimo) / 1000) : 0; T.ultimo = ts;
    const t = q('#tp-texto'); const caixa = q('#tp-roteiro');
    if (t && caixa) {
      const max = Math.max(0, t.scrollHeight - caixa.clientHeight * 0.3);
      T.pos = Math.min(max, T.pos + T.velocidade * dt); t.style.transform = `translateY(${-T.pos}px)`;
      if (T.pos >= max) { T.rolando = false; T.raf = null; return; }
    }
    T.raf = requestAnimationFrame(passo);
  }
  function rolar(ligar) { T.rolando = ligar; T.ultimo = 0; const p = q('#tp-pausado'); if (p) p.hidden = ligar || T.estado !== 'gravando'; if (ligar && !T.raf) T.raf = requestAnimationFrame(passo); }
  const alternarRolagem = () => rolar(!T.rolando);

  // ── Gravação ────────────────────────────────────────────────────────────────
  async function contagemEGravar() {
    if (!T.stream) return;
    setEstado('contagem', 'Prepare-se…'); const c = q('#tp-contagem'); c.hidden = false;
    for (let n = 3; n >= 1; n--) { c.querySelector('b').textContent = String(n); await new Promise((r) => setTimeout(r, 1000)); if (T.estado !== 'contagem') { c.hidden = true; return; } }
    c.hidden = true; gravar();
  }
  function gravar() {
    T.pedacos = []; T.blob = null;
    try { T.rec = T.mime ? new MediaRecorder(T.stream, { mimeType: T.mime, videoBitsPerSecond: 8_000_000 }) : new MediaRecorder(T.stream); }
    catch (e) { try { T.rec = new MediaRecorder(T.stream); T.mime = T.rec.mimeType || ''; } catch (e2) { setEstado('pronto', 'Pronto'); mostrarErro('Não consegui iniciar a gravação neste navegador. Grave com a câmera do celular e envie o arquivo pela aba Vídeos.'); return; } }
    T.rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) T.pedacos.push(ev.data); };
    T.rec.onerror = (ev) => { mostrarErro(`A gravação falhou: ${ev.error && ev.error.message ? ev.error.message : 'erro do navegador'}.`); pararGravacao(); };
    T.rec.onstop = aoParar;
    T.rec.start(1000);
    T.inicio = Date.now(); setEstado('gravando', 'Gravando'); mostrarErro('');
    clearInterval(T.cronoTimer); T.cronoTimer = setInterval(() => { const c = q('#tp-crono'); if (c) c.lastChild.textContent = mmss(Date.now() - T.inicio); }, 250);
    T.pos = 0; const t = q('#tp-texto'); if (t) t.style.transform = 'translateY(0px)'; rolar(true);
  }
  function pararGravacao() { clearInterval(T.cronoTimer); rolar(false); if (T.rec && T.rec.state !== 'inactive') { try { T.rec.stop(); } catch { aoParar(); } } }
  function aoParar() {
    const tipo = (T.rec && T.rec.mimeType) || T.mime || 'video/webm';
    T.blob = new Blob(T.pedacos, { type: tipo.split(';')[0] });
    const dur = Date.now() - T.inicio;
    if (!T.blob.size) { setEstado('pronto', 'Pronto'); mostrarErro('A gravação saiu vazia. Tente de novo; se repetir, grave com a câmera do celular e envie pela galeria.'); return; }
    if (T.urlPrevia) URL.revokeObjectURL(T.urlPrevia); T.urlPrevia = URL.createObjectURL(T.blob);
    const v = q('#tp-video-previa'); v.src = T.urlPrevia; v.muted = false;
    q('#tp-envio-texto').textContent = `${mmss(dur)} · ${(T.blob.size / 1048576).toFixed(1)} MB · ${/mp4/.test(tipo) ? 'MP4' : 'WebM'}. Confira e envie para a edição.`;
    setEstado('previa', 'Prévia');
  }
  async function enviar(blob, nome) {
    if (!window.Videos || !window.Videos.enviarArquivo) { mostrarErro('A aba Vídeos não carregou; atualize a página e tente de novo.'); return; }
    const b = blob || T.blob; if (!b) return;
    const ext = /mp4/.test(b.type) ? 'mp4' : /quicktime/.test(b.type) ? 'mov' : 'webm';
    const d = new Date(); const carimbo = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    setEstado('enviando', 'Enviando'); mostrarErro('');
    const barra = q('#tp-barra'); const txt = q('#tp-envio-texto');
    try {
      const r = await window.Videos.enviarArquivo(b, {
        nome: nome || `gravacao-${carimbo}.${ext}`, titulo: T.titulo || `Gravação ${d.toLocaleDateString('pt-BR')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        roteiro_id: T.roteiro_id, roteiro_texto: T.roteiro, estilo: T.estilo,
        onProgress: (p) => { if (barra) { barra.querySelector('i').style.width = `${Math.max(3, p.pct || 0)}%`; barra.setAttribute('aria-valuenow', String(p.pct || 0)); } if (txt) txt.textContent = p.etapa === 'criando' ? 'Preparando o envio…' : p.etapa === 'enviando' ? `Enviando ${p.pct}%… mantenha a tela aberta.` : p.etapa === 'registrando' ? 'Registrando na fila de edição…' : p.etapa === 'erro' ? p.erro : 'Enviado.'; },
      }, T.ctx);
      setEstado('enviado', 'Enviado'); if (txt) txt.textContent = 'Enviado! O editor começa em instantes; você recebe um aviso quando ficar pronto.';
      setTimeout(() => { if (T.aberto && T.estado === 'enviado') fechar(); }, 1800);
      return r;
    } catch (e) {
      setEstado('previa', 'Prévia'); mostrarErro(e.message || 'O envio falhou. Verifique a conexão e tente de novo; o vídeo continua aqui.');
      return null;
    }
  }

  // ── Wake Lock ───────────────────────────────────────────────────────────────
  async function manterTelaAcesa() { try { if (navigator.wakeLock && navigator.wakeLock.request && !T.wake) { T.wake = await navigator.wakeLock.request('screen'); T.wake.addEventListener('release', () => { T.wake = null; }); } } catch { /* sem suporte ou negado: segue sem */ } }
  function soltarTela() { try { if (T.wake) T.wake.release(); } catch { /* ignora */ } T.wake = null; }
  const aoVisibilidade = () => { if (!document.hidden && T.aberto) manterTelaAcesa(); };

  // ── Eventos ─────────────────────────────────────────────────────────────────
  function aoClicar(ev) {
    const b = ev.target.closest('[data-tp]'); if (!b) return;
    switch (b.dataset.tp) {
      case 'fechar': if (T.estado === 'gravando' && !confirm('Parar e descartar a gravação?')) return; fechar(); break;
      case 'gravar': if (T.estado === 'gravando') pararGravacao(); else if (T.estado === 'pronto') contagemEGravar(); break;
      case 'virar': T.facing = T.facing === 'user' ? 'environment' : 'user'; ligarCamera(); break;
      case 'editar': q('#tp-roteiro-edit').value = T.roteiro; q('#tp-editor').hidden = false; T.editando = true; q('#tp-roteiro-edit').focus(); break;
      case 'salvar-roteiro': T.roteiro = q('#tp-roteiro-edit').value; aplicarTexto(); q('#tp-editor').hidden = true; T.editando = false; break;
      case 'fechar-editor': q('#tp-editor').hidden = true; T.editando = false; break;
      case 'regravar': if (T.urlPrevia) URL.revokeObjectURL(T.urlPrevia); T.urlPrevia = null; T.blob = null; q('#tp-video-previa').removeAttribute('src'); mostrarErro(''); if (T.stream) setEstado('pronto', 'Pronto'); else ligarCamera(); aplicarTexto(); break;
      case 'estilo': T.estilo = b.dataset.estilo; T.el.querySelectorAll('.tp-estilo').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.estilo === T.estilo))); break;
      case 'enviar': enviar(); break;
      default:
    }
  }
  function aoAjustar(ev) {
    const t = ev.target;
    if (t.id === 'tp-vel') { T.velocidade = Number(t.value); q('#tp-vel-out').textContent = t.value; }
    if (t.id === 'tp-tam') { T.tamanho = Number(t.value); q('#tp-tam-out').textContent = t.value; const x = q('#tp-texto'); if (x) x.style.fontSize = `${T.tamanho}px`; }
  }
  function aoMudar(ev) {
    const t = ev.target; if (t.id !== 'tp-arquivo' || !t.files || !t.files[0]) return;
    const f = t.files[0]; T.blob = f; if (T.urlPrevia) URL.revokeObjectURL(T.urlPrevia); T.urlPrevia = URL.createObjectURL(f);
    q('#tp-video-previa').src = T.urlPrevia; q('#tp-envio-texto').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB. Confira e envie para a edição.`;
    setEstado('previa', 'Prévia'); mostrarErro('');
  }
  function aoTeclar(ev) {
    if (ev.key === 'Escape') { if (T.editando) { q('#tp-editor').hidden = true; T.editando = false; return; } if (T.estado !== 'gravando') fechar(); }
    if (ev.key === ' ' && !/TEXTAREA|INPUT|BUTTON/.test(ev.target.tagName) && ['pronto', 'gravando'].includes(T.estado)) { ev.preventDefault(); alternarRolagem(); }
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  function abrir({ roteiro = '', roteiro_id = null, titulo = '', ctx = null, estilo = 'hormozi' } = {}) {
    if (T.aberto) fechar();
    T.aberto = true; T.ctx = ctx || (window.Mesa && window.Mesa.ctx ? window.Mesa.ctx() : null);
    T.roteiro = String(roteiro || ''); T.roteiro_id = roteiro_id || null; T.titulo = String(titulo || ''); T.estilo = ESTILOS.some(([k]) => k === estilo) ? estilo : 'hormozi';
    T.facing = 'user'; T.blob = null; T.pedacos = []; T.pos = 0; T.rolando = false;
    montar(); aplicarTexto();
    q('#tp-vel').value = String(T.velocidade); q('#tp-vel-out').textContent = String(T.velocidade); q('#tp-tam').value = String(T.tamanho); q('#tp-tam-out').textContent = String(T.tamanho);
    T.el.querySelectorAll('.tp-estilo').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.estilo === T.estilo)));
    document.addEventListener('visibilitychange', aoVisibilidade);
    manterTelaAcesa(); ligarCamera();
    setTimeout(() => { const b = q('[data-tp="fechar"]'); if (b && T.aberto) b.focus({ preventScroll: true }); }, 50);
    return T.el;
  }
  function fechar() {
    if (!T.aberto) return;
    if (T.rec && T.rec.state !== 'inactive') { try { T.rec.onstop = null; T.rec.stop(); } catch { /* já parou */ } }
    clearInterval(T.cronoTimer); if (T.raf) cancelAnimationFrame(T.raf); T.raf = null; T.rolando = false;
    pararStream(); soltarTela(); document.removeEventListener('visibilitychange', aoVisibilidade);
    if (T.urlPrevia) { URL.revokeObjectURL(T.urlPrevia); T.urlPrevia = null; }
    if (T.el) { T.el.remove(); T.el = null; }
    document.body.classList.remove('tp-aberto');
    T.aberto = false; T.estado = 'preparando'; T.blob = null; T.pedacos = [];
    const ctx = T.ctx; if (ctx && ctx.render && window.Videos) { try { ctx.render(); } catch { /* a tela de fundo cuida de si */ } }
  }
  window.Teleprompter = { abrir, fechar, _st: T, suporta: suportaGravacao, escolherMime };
})();
