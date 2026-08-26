/* Service worker — casca offline. SUBA O NÚMERO a cada publicação, senão o
   navegador continua servindo o arquivo velho (lição paga mais de uma vez). */
const CACHE = 'pdb-shell-v1';
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'config.js', 'ui.js', 'store.js', 'carne.js',
  'pdf.js', 'espelho.js', 'vendas.js', 'caixa.js', 'cadastros.js', 'cronograma.js', 'apresentacao.js', 'contratos.js', 'omie.js', 'app.js',
  'libs/jspdf.umd.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/logo-full.png', 'icons/logo-pdf.png'
];

self.addEventListener('install', (e) => {
  // cache:'reload' força buscar DA REDE na instalação — sem isso o cache novo
  // nascia com arquivos velhos herdados do cache HTTP do navegador, e nem
  // "recarregar 2 vezes" resolvia.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Só a casca do próprio site; chamadas de API passam direto.
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
      fetch(e.request).then((r) => {
        if (r.ok && e.request.method === 'GET') {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      }))
  );
});
