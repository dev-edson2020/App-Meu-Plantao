const CACHE_NAME = 'meu-plantao-shell-v1';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(SHELL_URL, { cache: 'reload' });
    if (!response.ok) throw new Error('Falha ao carregar a tela do aplicativo para uso offline.');
    const html = await response.clone().text();
    await cache.put(SHELL_URL, response);

    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      .map((match) => new URL(match[1], self.location.origin).href)
      .filter((url) => new URL(url).origin === self.location.origin);
    const pending = [...assets];
    const cached = new Set();
    while (pending.length) {
      const url = pending.pop();
      if (cached.has(url)) continue;
      cached.add(url);
      try {
        const asset = await fetch(url, { cache: 'reload' });
        if (!asset.ok) continue;
        const source = url.endsWith('.js') ? await asset.clone().text() : '';
        await cache.put(url, asset);
        for (const match of source.matchAll(/(?:import\s*\(\s*|from\s*)["'](\.\.?\/[^"']+\.js)["']/g)) {
          const dependency = new URL(match[1], url).href;
          if (new URL(dependency).origin === self.location.origin && !cached.has(dependency)) pending.push(dependency);
        }
      } catch { /* A chunk that cannot be fetched now remains available after the next online visit. */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('meu-plantao-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(SHELL_URL, response.clone());
        return response;
      } catch {
        return (await caches.match(SHELL_URL)) ?? Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font')) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await cache.match(request)) ?? Response.error();
    }
  })());
});
