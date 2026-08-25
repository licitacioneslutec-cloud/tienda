/* Service worker: hace que la tienda funcione como app instalada
   y siga abriendo aunque se caiga el internet.

   Estrategia: para lo propio del sitio se intenta la red primero, con un
   límite de paciencia; si no responde a tiempo se usa lo guardado. Así una
   versión nueva publicada en Netlify entra en la siguiente apertura, y sin
   internet la tienda abre igual con la última copia.

   Al cambiar el código, sube el número de VERSION. */

const VERSION = 'tienda-v4.0';
const ESPERA_RED = 2500; // milisegundos antes de rendirse y usar la copia

const BASE = [
  './', './index.html', './styles.css', './app.js', './firebase-config.js', './manifest.json',
  './iconos/icono-192.png', './iconos/icono-512.png',
  './iconos/icono-maskable-512.png', './iconos/favicon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(BASE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La tableta puede pedir que se revise si hay algo nuevo.
self.addEventListener('message', e => {
  if (e.data === 'actualizar') self.skipWaiting();
});

function archivar(peticion, respuesta) {
  if (!respuesta || respuesta.status !== 200) return;
  if (respuesta.type !== 'basic' && respuesta.type !== 'cors') return;
  caches.open(VERSION).then(c => c.put(peticion, respuesta));
}

function conLimite(promesa, ms) {
  return new Promise((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('lenta')), ms);
    promesa.then(r => { clearTimeout(reloj); resolver(r); },
                 e => { clearTimeout(reloj); rechazar(e); });
  });
}

self.addEventListener('fetch', e => {
  const peticion = e.request;

  // El webhook de n8n y cualquier otro envío pasan de largo.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Lo propio del sitio: red primero, copia como red de seguridad.
  if (url.origin === location.origin) {
    e.respondWith(
      conLimite(fetch(peticion), ESPERA_RED)
        .then(r => { archivar(peticion, r.clone()); return r; })
        .catch(() => caches.match(peticion)
          .then(g => g || (peticion.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  // Fuentes y librerías externas: copia primero, que casi nunca cambian.
  e.respondWith(
    caches.match(peticion).then(guardado =>
      guardado || fetch(peticion)
        .then(r => { archivar(peticion, r.clone()); return r; })
        .catch(() => Response.error()))
  );
});
