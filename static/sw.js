// Service worker mínimo: só notificações. Não guarda arquivos em cache (evita servir versão velha do app).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { corpo: event.data ? event.data.text() : '' }; }
  const titulo = d.titulo || 'Pedro Destrava';
  event.waitUntil((async () => {
    await self.registration.showNotification(titulo, {
      body: d.corpo || 'Há conteúdo novo para aprovar',
      icon: '/app-icon-192.png', badge: '/app-icon-192.png', tag: d.tag || 'lote-aprovacao', renotify: true,
      data: { url: typeof d.url === 'string' && d.url.startsWith('/?') ? d.url : '/?tab=central' },
    });
    if (self.navigator && 'setAppBadge' in self.navigator && d.n) { try { await self.navigator.setAppBadge(d.n); } catch { /* sem suporte */ } }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const alvo = (event.notification.data && event.notification.data.url) || '/?tab=central';
  event.waitUntil((async () => {
    const todos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of todos) {
      if ('focus' in c) { await c.focus(); c.postMessage(String(alvo).includes('tab=radar') ? { tipo: 'abrir-aba', aba: 'radar' } : { tipo: 'abrir-central' }); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(alvo);
  })());
});
