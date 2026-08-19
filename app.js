/* ═══════════════════════════════════════════════════════════
   Tienda interna · versión 2
   Fotos de producto, número corto, teclado numérico,
   escaneo con la cámara, verificación de pagos e historial.
   Los datos viven en el navegador de la tableta.
   ═══════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const K = {
  usuarios : 'ti_usuarios',
  productos: 'ti_productos',
  pedidos  : 'ti_pedidos',
  soportes : 'ti_soportes',
  config   : 'ti_config',
  sesion   : 'ti_sesion'
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
};

function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
  catch {
    aviso('No queda espacio en la tableta. Borra soportes o pedidos cerrados desde Respaldo.', 'error');
    return false;
  }
}

const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoy  = () => new Date().toISOString().slice(0, 10);
const esc  = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function folioNuevo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let f = '';
  for (let i = 0; i < 6; i++) f += letras[Math.floor(Math.random() * letras.length)];
  return f.slice(0, 3) + '-' + f.slice(3);
}

const ESTADOS = {
  aprobado  : { texto: 'Aprobado, sin verificar', clase: 'pendiente' },
  verificado: { texto: 'Verificado',              clase: 'ok' },
  pendiente : { texto: 'Pendiente de nómina',     clase: 'nomina' },
  conciliado: { texto: 'Descontado',              clase: 'ok' }
};
const marcaEstado = e => {
  const i = ESTADOS[e] || { texto: e, clase: 'inactivo' };
  return `<span class="marca marca-${i.clase}">${i.texto}</span>`;
};

let config = {};
const money = n => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: config.moneda || 'COP', maximumFractionDigits: 0
}).format(Number(n) || 0);
const fecha = iso => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = 'aviso ' + (tipo ? 'aviso-' + tipo : '');
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), 3500);
}

async function hashClave(clave, sal) {
  const txt = sal + '::' + clave;
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = (((h << 5) + h) ^ txt.charCodeAt(i)) >>> 0;
  return 'simple_' + h.toString(16);
}

/* ── Códigos enviados por correo ─────────────────────────── */
const enmascarar = c => String(c || '').replace(/^(.).*(@.*)$/, (m, a, b) => a + '•••' + b);

async function enviarCodigoCorreo(u, usuarios) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const sal = uid();
  const otp = { hash: await hashClave(codigo, sal), sal, expira: Date.now() + 15 * 60 * 1000, intentos: 0 };

  const r = await fetch('/.netlify/functions/enviar-codigo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ para: u.correo, codigo, nombre: u.nombre, empresa: config.empresa })
  });
  if (!r.ok) throw new Error(await r.text());

  u.otp = otp;
  guardar(K.usuarios, usuarios);
}

$('#rec-enviar').addEventListener('click', async () => {
  const cedula = $('#rec-cedula').value.trim();
  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.cedula === cedula && x.activo !== false);
  const aparente = 'Si esa identificación está registrada con un correo, allí llegará el código. Vence en 15 minutos.';

  if (!config.correoRecuperacion)
    return aviso('La recuperación por correo está apagada. Usa el código de administrador o pide ayuda.', 'error');
  if (!cedula) return aviso('Escribe tu número de identificación.', 'error');

  $('#rec-aviso-envio').textContent = 'Enviando…';
  if (!u || !u.correo) { $('#rec-aviso-envio').textContent = aparente; return; }

  try {
    await enviarCodigoCorreo(u, usuarios);
    $('#rec-aviso-envio').textContent = `Código enviado a ${enmascarar(u.correo)}. Vence en 15 minutos.`;
  } catch {
    $('#rec-aviso-envio').textContent = 'No se pudo enviar el correo. Revisa la configuración en Netlify o pídele ayuda al administrador.';
  }
});

/* ── Códigos de recuperación ─────────────────────────────── */
const soloDigitos = s => String(s ?? '').replace(/\D/g, '');

function nuevoCodigo() {
  let d = '';
  for (let i = 0; i < 12; i++) d += Math.floor(Math.random() * 10);
  return d.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3');
}

/* Genera un código nuevo para el usuario y guarda solo su huella cifrada. */
async function asignarCodigo(u) {
  const codigo = nuevoCodigo();
  u.salRec = uid();
  u.recuperacion = await hashClave(soloDigitos(codigo), u.salRec);
  return codigo;
}

let textoCodigo = '';
function mostrarCodigo(codigo, { titulo, texto, extra = [] }) {
  $('#codigo-titulo').textContent = titulo;
  $('#codigo-texto').textContent = texto;
  $('#codigo-valor').textContent = codigo;
  $('#codigo-extra').innerHTML = extra
    .map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  textoCodigo =
`${config.empresa || 'Tienda interna'} — datos de acceso
Generado: ${new Date().toLocaleString('es-CO')}

${extra.map(([k, v]) => `${k}: ${v}`).join('\n')}
Código de recuperación: ${codigo}

Guarda este archivo fuera de la tableta. El código sirve una sola vez
para cambiar la contraseña del administrador desde la pantalla de ingreso.`;
  abrirModal('modal-codigo');
}

$('#codigo-listo').addEventListener('click', () => cerrarModal('modal-codigo'));
$('#codigo-descargar').addEventListener('click', () =>
  descargar(`acceso_tienda_${hoy()}.txt`, textoCodigo, 'text/plain'));

/* Los administradores creados antes de esta versión reciben su código al entrar. */
async function asegurarCodigo(u) {
  if (u.rol !== 'admin' || u.recuperacion) return;
  const usuarios = leerUsuarios();
  const real = usuarios.find(x => x.id === u.id); if (!real) return;
  const codigo = await asignarCodigo(real);
  guardar(K.usuarios, usuarios);
  u.salRec = real.salRec; u.recuperacion = real.recuperacion;
  mostrarCodigo(codigo, {
    titulo: 'Guarda tu código de recuperación',
    texto: 'Con este código puedes cambiar tu contraseña desde la pantalla de ingreso si algún día la olvidas.',
    extra: [['Identificación', u.cedula], ['Nombre', u.nombre]]
  });
}

$('#btn-olvide').addEventListener('click', () => {
  ['#rec-cedula', '#rec-codigo', '#rec-clave', '#rec-clave2'].forEach(s => $(s).value = '');
  $('#rec-aviso-envio').textContent = '';
  $('#rec-enviar').hidden = !config.correoRecuperacion;
  abrirModal('modal-recuperar');
});

$('#rec-confirmar').addEventListener('click', async () => {
  const cedula = $('#rec-cedula').value.trim();
  const codigo = soloDigitos($('#rec-codigo').value);
  const clave  = $('#rec-clave').value.trim();
  const clave2 = $('#rec-clave2').value.trim();

  if (clave.length < 4) return aviso('La nueva contraseña necesita al menos 4 dígitos.', 'error');
  if (clave !== clave2) return aviso('Las dos contraseñas no coinciden.', 'error');

  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.cedula === cedula && x.activo !== false);
  if (!u) return aviso('La identificación o el código no coinciden.', 'error');

  let valido = false, usoCodigoAdmin = false;

  // Código de un solo uso enviado al correo
  if (u.otp && Date.now() < u.otp.expira && (u.otp.intentos || 0) < 5) {
    if (await hashClave(codigo, u.otp.sal) === u.otp.hash) valido = true;
    else { u.otp.intentos = (u.otp.intentos || 0) + 1; guardar(K.usuarios, usuarios); }
  }
  // Código de recuperación del administrador
  if (!valido && u.rol === 'admin' && u.recuperacion && await hashClave(codigo, u.salRec) === u.recuperacion) {
    valido = true; usoCodigoAdmin = true;
  }
  if (!valido) return aviso('La identificación o el código no coinciden.', 'error');

  u.sal = uid();
  u.clave = await hashClave(clave, u.sal);
  u.activo = true;
  u.debeCambiar = false;
  delete u.otp;
  const siguiente = usoCodigoAdmin ? await asignarCodigo(u) : null;
  if (!guardar(K.usuarios, usuarios)) return;

  cerrarModal('modal-recuperar');
  if (siguiente) {
    mostrarCodigo(siguiente, {
      titulo: 'Contraseña cambiada',
      texto: 'Ya puedes entrar con la contraseña nueva. Este es tu código de recuperación actualizado: el anterior dejó de servir.',
      extra: [['Identificación', u.cedula], ['Nombre', u.nombre]]
    });
  } else {
    aviso('Contraseña cambiada. Ya puedes entrar.', 'ok');
  }
});

/* ── Cambio de contraseña del propio usuario ─────────────── */
let cambioObligatorio = false;

function abrirCambioClave(obligatorio) {
  cambioObligatorio = obligatorio;
  ['#clave-actual', '#clave-nueva', '#clave-nueva2'].forEach(s => $(s).value = '');
  $('#clave-titulo').textContent = obligatorio ? 'Crea tu contraseña' : 'Cambiar mi contraseña';
  $('#clave-texto').textContent = obligatorio
    ? 'Estás usando la contraseña genérica. Define una propia antes de continuar.'
    : 'Debe tener al menos 4 dígitos.';
  $('#campo-clave-actual').hidden = obligatorio;
  $('#clave-cancelar').hidden = obligatorio;
  $('#modal-cambiar-clave').classList.toggle('fijo', obligatorio);
  abrirModal('modal-cambiar-clave');
}

$('#btn-mi-clave').addEventListener('click', () => abrirCambioClave(false));
$('#clave-cancelar').addEventListener('click', () => cerrarModal('modal-cambiar-clave'));

$('#clave-guardar').addEventListener('click', async () => {
  const nueva = $('#clave-nueva').value.trim();
  const nueva2 = $('#clave-nueva2').value.trim();
  if (nueva.length < 4) return aviso('La contraseña necesita al menos 4 dígitos.', 'error');
  if (nueva !== nueva2) return aviso('Las dos contraseñas no coinciden.', 'error');

  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.id === usuario.id); if (!u) return;

  if (!cambioObligatorio) {
    const actual = $('#clave-actual').value;
    if (await hashClave(actual, u.sal) !== u.clave) return aviso('La contraseña actual no coincide.', 'error');
  }

  u.sal = uid();
  u.clave = await hashClave(nueva, u.sal);
  u.debeCambiar = false;
  delete u.otp;
  if (!guardar(K.usuarios, usuarios)) return;

  usuario = u;
  cambioObligatorio = false;
  $('#modal-cambiar-clave').classList.remove('fijo');
  cerrarModal('modal-cambiar-clave');
  aviso('Contraseña actualizada', 'ok');
});

/* ── Imágenes ────────────────────────────────────────────── */
function comprimirImagen(archivo, maxLado = 640, calidad = 0.75) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('lectura'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => rechazar(new Error('imagen'));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
        resolver(lienzo.toDataURL('image/jpeg', calidad));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

const leerArchivo = archivo => new Promise((ok, mal) => {
  const l = new FileReader();
  l.onload = () => ok(l.result); l.onerror = mal; l.readAsDataURL(archivo);
});

function abrirDataURL(datos, nombre) {
  const [cabecera, base64] = datos.split(',');
  const tipo = cabecera.match(/:(.*?);/)[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = nombre || '';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Datos ───────────────────────────────────────────────── */
let productos = [];
const leerUsuarios = () => LS.get(K.usuarios, []);
const leerPedidos  = () => LS.get(K.pedidos, []);
const leerSoportes = () => LS.get(K.soportes, []);
const refrescarProductos = () => { productos = LS.get(K.productos, []); };

const CONFIG_BASE = {
  empresa: 'Tienda interna', correo: '', codigoCorto: '',
  instrucciones: 'Escanea el código con tu app de pagos. El administrador confirmará el pago después.',
  qr: '', moneda: 'COP', usarFuncion: false,
  claveGenerica: '1234', correoRecuperacion: true
};

function siguienteNumero(lista) {
  const usados = lista.map(p => parseInt(p.numero, 10)).filter(n => !isNaN(n));
  const n = (usados.length ? Math.max(...usados) : 0) + 1;
  return String(n).padStart(2, '0');
}

let codigoInicial = null;

async function inicializarDatos() {
  config = { ...CONFIG_BASE, ...LS.get(K.config, {}) };
  guardar(K.config, config);

  if (!localStorage.getItem(K.productos)) {
    guardar(K.productos, [
      { id: uid(), numero: '01', codigo: '7702001010101', nombre: 'Café en vaso',      precio: 2500, categoria: 'Bebidas', foto: '', activo: true },
      { id: uid(), numero: '02', codigo: '7702001010102', nombre: 'Agua 600 ml',       precio: 3000, categoria: 'Bebidas', foto: '', activo: true },
      { id: uid(), numero: '03', codigo: '7702001010103', nombre: 'Galletas surtidas', precio: 4200, categoria: 'Snacks',  foto: '', activo: true }
    ]);
  }
  refrescarProductos();

  // Productos antiguos sin número corto
  let cambio = false;
  productos.forEach(p => {
    if (!p.numero) { p.numero = siguienteNumero(productos); cambio = true; }
    if (p.foto === undefined) { p.foto = ''; cambio = true; }
  });
  if (cambio) guardar(K.productos, productos);

  // Pedidos antiguos: el pago inmediato pasa a "aprobado"
  const pedidos = leerPedidos();
  let cambioP = false;
  pedidos.forEach(p => {
    if (p.metodo === 'qr' && p.estado === 'pendiente') { p.estado = 'aprobado'; cambioP = true; }
  });
  if (cambioP) guardar(K.pedidos, pedidos);

  if (!localStorage.getItem(K.usuarios)) {
    const sal = uid();
    const admin = {
      id: uid(), nombre: 'Administrador', cedula: '0000', rol: 'admin',
      sal, clave: await hashClave('1234', sal), activo: true, creado: new Date().toISOString()
    };
    codigoInicial = await asignarCodigo(admin);
    guardar(K.usuarios, [admin]);
    $('#nota-admin').textContent = 'Primer ingreso: identificación 0000 y contraseña 1234. Cámbiala en Usuarios.';
  }
}

/* ── Teclado numérico ────────────────────────────────────── */
function montarTeclado(contenedor, opciones) {
  const teclas = ['1','2','3','4','5','6','7','8','9'];
  contenedor.innerHTML =
    teclas.map(t => `<button type="button" class="tecla" data-digito="${t}">${t}</button>`).join('') +
    `<button type="button" class="tecla" data-accion="borrar" aria-label="Borrar">⌫</button>` +
    `<button type="button" class="tecla" data-digito="0">0</button>` +
    `<button type="button" class="tecla tecla-accion" data-accion="ok">${opciones.etiqueta}</button>`;

  contenedor.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.digito) opciones.onDigito(b.dataset.digito);
    else if (b.dataset.accion === 'borrar') opciones.onBorrar();
    else opciones.onOk();
  });
}

/* Teclado del ingreso */
let campoLogin = null;
function prepararTecladoLogin() {
  campoLogin = $('#login-cedula');
  [$('#login-cedula'), $('#login-clave')].forEach(i =>
    i.addEventListener('focus', () => { campoLogin = i; }));

  montarTeclado($('#teclado-login'), {
    etiqueta: 'OK',
    onDigito: d => { campoLogin.value += d; },
    onBorrar: () => { campoLogin.value = campoLogin.value.slice(0, -1); },
    onOk: () => {
      if (campoLogin === $('#login-cedula') && $('#login-cedula').value) $('#login-clave').focus();
      else $('#form-login').requestSubmit();
    }
  });
}

/* Teclado de la tienda */
let numeroBuffer = '';
function prepararTecladoNumero() {
  const pintar = () => { $('#visor-numero').textContent = numeroBuffer || '—'; };
  montarTeclado($('#teclado-numero'), {
    etiqueta: 'Agregar',
    onDigito: d => { if (numeroBuffer.length < 6) numeroBuffer += d; pintar(); },
    onBorrar: () => { numeroBuffer = numeroBuffer.slice(0, -1); pintar(); },
    onOk: () => {
      if (!numeroBuffer) return aviso('Escribe el número del producto.', 'error');
      if (agregarPorNumero(numeroBuffer)) { numeroBuffer = ''; pintar(); }
    }
  });
}

$('#btn-teclado').addEventListener('click', () => {
  const b = $('#buscador');
  b.hidden = !b.hidden;
  numeroBuffer = ''; $('#visor-numero').textContent = '—';
});
$('#cerrar-buscador').addEventListener('click', () => { $('#buscador').hidden = true; enfocarEscaner(); });

/* ── Sesión ──────────────────────────────────────────────── */
let usuario = null;
let carrito = [];

function mostrar(idPantalla) {
  $$('.pantalla').forEach(p => p.classList.remove('activa'));
  $('#' + idPantalla).classList.add('activa');
  if (idPantalla === 'pantalla-tienda') setTimeout(enfocarEscaner, 60);
}

function abrirSesion(u) {
  usuario = u;
  guardar(K.sesion, { id: u.id, ts: Date.now() });
  $('#tienda-usuario').textContent = u.nombre;
  $('#admin-usuario').textContent  = u.nombre;
  $('#btn-ir-admin').hidden = u.rol !== 'admin';
  carrito = [];
  pintarCarrito();
  pintarRejilla();
  mostrar('pantalla-tienda');
  asegurarCodigo(u);
  if (u.debeCambiar) setTimeout(() => abrirCambioClave(true), 300);
}

function cerrarSesion() {
  usuario = null; carrito = [];
  localStorage.removeItem(K.sesion);
  $('#form-login').reset();
  $('#buscador').hidden = true;
  mostrar('pantalla-login');
}

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const cedula = $('#login-cedula').value.trim();
  const clave  = $('#login-clave').value;
  const u = leerUsuarios().find(x => x.cedula === cedula && x.activo !== false);
  if (!u) return aviso('No encontramos esa identificación.', 'error');
  if (await hashClave(clave, u.sal) !== u.clave) return aviso('La contraseña no coincide.', 'error');
  abrirSesion(u);
});

$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-salir-admin').addEventListener('click', cerrarSesion);
$('#btn-ir-admin').addEventListener('click', () => {
  if (usuario?.rol !== 'admin') return;
  mostrar('pantalla-admin'); pintarProductos();
});
$('#btn-volver-tienda').addEventListener('click', () => mostrar('pantalla-tienda'));

/* ── Escáner ─────────────────────────────────────────────── */
function enfocarEscaner() {
  if (!$('#pantalla-tienda').classList.contains('activa')) return;
  if ($('.modal.abierto')) return;
  if (!$('#buscador').hidden) return;
  $('#entrada-codigo').focus();
}
document.addEventListener('click', e => {
  if (e.target.closest('button, input, select, textarea, label, a')) return;
  enfocarEscaner();
});
setInterval(enfocarEscaner, 2500);

$('#entrada-codigo').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const codigo = e.target.value.trim();
  e.target.value = '';
  if (codigo) agregarPorCodigo(codigo);
});

function buscarProducto(valor) {
  const v = String(valor).trim();
  return productos.find(p => p.activo !== false && (
    p.codigo === v ||
    p.numero === v ||
    (v !== '' && p.numero !== '' && !isNaN(v) && !isNaN(p.numero) && Number(p.numero) === Number(v))
  ));
}

function agregarPorCodigo(codigo) {
  const p = buscarProducto(codigo);
  if (!p) { aviso('Código no registrado: ' + codigo, 'error'); return false; }
  agregarProducto(p); return true;
}

function agregarPorNumero(numero) {
  const p = buscarProducto(numero);
  if (!p) { aviso('No hay ningún producto con el número ' + numero, 'error'); return false; }
  agregarProducto(p); return true;
}

function agregarProducto(p) {
  const item = carrito.find(i => i.numero === p.numero);
  if (item) item.cantidad++;
  else carrito.push({ numero: p.numero, codigo: p.codigo || '', nombre: p.nombre, precio: Number(p.precio), cantidad: 1 });
  pintarCarrito();
  aviso(p.nombre + ' agregado', 'ok');
}

const totalCarrito = () => carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
const fotoDe = numero => (productos.find(p => p.numero === numero) || {}).foto || '';

function miniatura(numero) {
  const f = fotoDe(numero);
  return f ? `<img class="mini-foto" src="${f}" alt="">`
           : `<div class="mini-foto-vacia">${esc(numero || '·')}</div>`;
}

function pintarCarrito() {
  const ul = $('#lista-carrito');
  ul.innerHTML = carrito.length ? '' : '<li class="vacio">Pasa el primer producto por el lector.</li>';
  carrito.forEach((i, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      ${miniatura(i.numero)}
      <div class="nom"><b>${esc(i.nombre)}</b><span>N.º ${esc(i.numero)} · ${money(i.precio)}</span></div>
      <div class="cant">
        <button type="button" data-menos="${idx}" aria-label="Quitar uno">−</button>
        <b>${i.cantidad}</b>
        <button type="button" data-mas="${idx}" aria-label="Agregar uno">+</button>
      </div>
      <div class="precio">${money(i.precio * i.cantidad)}</div>`;
    ul.append(li);
  });
  $('#total-carrito').textContent = money(totalCarrito());
  const vacio = carrito.length === 0;
  $('#btn-pagar-qr').disabled = vacio;
  $('#btn-pagar-nomina').disabled = vacio;
}

$('#lista-carrito').addEventListener('click', e => {
  const mas = e.target.dataset.mas, menos = e.target.dataset.menos;
  if (mas !== undefined) carrito[+mas].cantidad++;
  if (menos !== undefined && --carrito[+menos].cantidad <= 0) carrito.splice(+menos, 1);
  if (mas !== undefined || menos !== undefined) pintarCarrito();
});

$('#btn-vaciar').addEventListener('click', () => { carrito = []; pintarCarrito(); enfocarEscaner(); });

function pintarRejilla() {
  const cont = $('#rejilla-productos');
  const lista = productos.filter(p => p.activo !== false);
  cont.innerHTML = '';
  if (!lista.length) {
    cont.innerHTML = '<p class="vacio">Todavía no hay productos cargados.</p>';
    return;
  }
  lista.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'producto';
    b.innerHTML = `
      <div class="producto-foto">
        ${p.foto ? `<img src="${p.foto}" alt="">` : '<span class="sinfoto">◻</span>'}
        <span class="producto-num">${esc(p.numero)}</span>
      </div>
      <div class="producto-info"><b>${esc(p.nombre)}</b><span>${money(p.precio)}</span></div>`;
    b.addEventListener('click', () => agregarProducto(p));
    cont.append(b);
  });
}

/* ── Cámara ──────────────────────────────────────────────── */
let flujoCamara = null, bucleCamara = null, lectorZX = null;

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error('script'));
    document.head.append(s);
  });
}

$('#btn-camara').addEventListener('click', abrirCamara);
$('#cerrar-camara').addEventListener('click', () => cerrarModal('modal-camara'));

async function abrirCamara() {
  abrirModal('modal-camara');
  const video = $('#video-camara');
  const estado = $('#camara-estado');
  estado.textContent = 'Abriendo la cámara…';

  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      detector = new window.BarcodeDetector({
        formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','qr_code']
      });
    } catch { detector = null; }
  }

  if (detector) {
    try {
      flujoCamara = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = flujoCamara;
      await video.play();
    } catch {
      estado.textContent = 'No pudimos abrir la cámara. Revisa los permisos del navegador o usa el lector.';
      return;
    }
    estado.textContent = 'Apunta al código de barras.';
    const revisar = async () => {
      if (!flujoCamara) return;
      try {
        const encontrados = await detector.detect(video);
        if (encontrados.length) return codigoCapturado(encontrados[0].rawValue);
      } catch { /* sigue intentando */ }
      bucleCamara = requestAnimationFrame(revisar);
    };
    revisar();
    return;
  }

  // Respaldo para navegadores sin detector nativo (iPad, Firefox…)
  try {
    estado.textContent = 'Preparando el lector…';
    if (!window.ZXing) await cargarScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
    lectorZX = new window.ZXing.BrowserMultiFormatReader();
    await lectorZX.decodeFromVideoDevice(null, video, resultado => {
      if (resultado) codigoCapturado(resultado.getText());
    });
    estado.textContent = 'Apunta al código de barras.';
  } catch {
    estado.textContent = 'Este navegador no permite escanear con la cámara. Usa el lector o el teclado numérico.';
  }
}

function detenerCamara() {
  if (bucleCamara) { cancelAnimationFrame(bucleCamara); bucleCamara = null; }
  if (lectorZX) { try { lectorZX.reset(); } catch {} lectorZX = null; }
  if (flujoCamara) { flujoCamara.getTracks().forEach(t => t.stop()); flujoCamara = null; }
  const v = $('#video-camara');
  if (v) v.srcObject = null;
}

function codigoCapturado(valor) {
  detenerCamara();
  $('#modal-camara').classList.remove('abierto');
  agregarPorCodigo(valor);
  enfocarEscaner();
}

/* ── Modales ─────────────────────────────────────────────── */
function abrirModal(id) { $('#' + id).classList.add('abierto'); }
function cerrarModal(id) {
  if (id === 'modal-camara') detenerCamara();
  $('#' + id).classList.remove('abierto');
  enfocarEscaner();
}
$$('[data-cerrar]').forEach(b => b.addEventListener('click', e => cerrarModal(e.target.closest('.modal').id)));
$$('.modal').forEach(m => m.addEventListener('click', e => {
  if (e.target === m && !m.classList.contains('fijo')) cerrarModal(m.id);
}));

/* ── Pagos ───────────────────────────────────────────────── */
$('#btn-pagar-qr').addEventListener('click', () => {
  $('#qr-total').textContent = money(totalCarrito());
  $('#qr-imagen').innerHTML = config.qr ? `<img src="${config.qr}" alt="Código QR de pago">` : '';
  $('#qr-codigo').textContent = config.codigoCorto || '';
  $('#qr-instrucciones').textContent = config.instrucciones || '';
  $('#qr-referencia').value = '';
  abrirModal('modal-qr');
});

$('#qr-confirmar').addEventListener('click', () => {
  const ref = $('#qr-referencia').value.trim();
  cerrarModal('modal-qr');
  guardarPedido('qr', ref, 'aprobado');
});

$('#btn-pagar-nomina').addEventListener('click', () => {
  $('#nomina-total').textContent = money(totalCarrito());
  const acum = leerPedidos()
    .filter(p => p.usuarioId === usuario.id && p.metodo === 'nomina' && p.estado === 'pendiente')
    .reduce((s, p) => s + p.total, 0);
  $('#nomina-acumulado').textContent = acum
    ? `Ya tienes ${money(acum)} pendientes de descuento este período.`
    : 'Es tu primer pedido pendiente de descuento este período.';
  $('#nomina-acepto').checked = false;
  abrirModal('modal-nomina');
});

$('#nomina-confirmar').addEventListener('click', () => {
  if (!$('#nomina-acepto').checked) return aviso('Marca la autorización para continuar.', 'error');
  cerrarModal('modal-nomina');
  guardarPedido('nomina', '', 'pendiente');
});

function guardarPedido(metodo, referencia, estado) {
  const pedido = {
    id: uid(), folio: folioNuevo(),
    usuarioId: usuario.id, nombre: usuario.nombre, cedula: usuario.cedula,
    items: carrito.map(i => ({ ...i })),
    total: totalCarrito(),
    metodo, referencia, estado,
    historial: [],
    creado: new Date().toISOString()
  };
  const pedidos = leerPedidos();
  pedidos.push(pedido);
  if (!guardar(K.pedidos, pedidos)) return;

  $('#recibo-folio').textContent = pedido.folio;
  $('#recibo-lista').innerHTML = pedido.items.map(i =>
    `<li>${miniatura(i.numero)}<div class="nom"><b>${esc(i.nombre)}</b><span>${i.cantidad} × ${money(i.precio)}</span></div>
     <div></div><div class="precio">${money(i.precio * i.cantidad)}</div></li>`).join('');
  $('#recibo-total').textContent = money(pedido.total);
  $('#recibo-metodo').textContent = metodo === 'nomina'
    ? 'Se descontará de tu nómina. Guarda el código del pedido.'
    : 'Pago aprobado. El administrador lo verificará con el soporte del banco.';

  carrito = [];
  pintarCarrito();
  abrirModal('modal-recibo');
}

$('#recibo-listo').addEventListener('click', () => cerrarModal('modal-recibo'));

/* ── Historial del empleado ──────────────────────────────── */
$('#btn-mis-compras').addEventListener('click', () => {
  const mios = leerPedidos().filter(p => p.usuarioId === usuario.id)
    .sort((a, b) => b.creado.localeCompare(a.creado));
  const total = mios.reduce((s, p) => s + p.total, 0);
  const pendiente = mios.filter(p => p.metodo === 'nomina' && p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
  const porVerificar = mios.filter(p => p.estado === 'aprobado').reduce((s, p) => s + p.total, 0);

  $('#historial-resumen').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${mios.length}</b></div>
    <div><span class="eyebrow">Total comprado</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Pendiente de nómina</span><b>${money(pendiente)}</b></div>
    <div><span class="eyebrow">Por verificar</span><b>${money(porVerificar)}</b></div>`;

  $('#tabla-historial').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Productos</th><th class="num">Total</th><th>Estado</th></tr></thead>
    <tbody>${mios.length ? mios.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${p.items.map(i => `${i.cantidad}× ${esc(i.nombre)}`).join('<br>')}</td>
        <td class="num">${money(p.total)}</td>
        <td>${marcaEstado(p.estado)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="vacio">Todavía no has hecho compras.</td></tr>'}</tbody>`;

  abrirModal('modal-historial');
});

/* ── Administración: pestañas ────────────────────────────── */
$('#pestanas').addEventListener('click', e => {
  const b = e.target.closest('.pestana'); if (!b) return;
  $$('.pestana').forEach(x => x.classList.remove('activa'));
  $$('.panel').forEach(x => x.classList.remove('activa'));
  b.classList.add('activa');
  $('#panel-' + b.dataset.panel).classList.add('activa');
  ({
    productos: pintarProductos, usuarios: pintarUsuarios, pedidos: pintarPedidos,
    verificacion: pintarVerificacion, ajustes: pintarAjustes, respaldo: pintarEspacio
  }[b.dataset.panel] || (() => {}))();
});

/* ── Productos ───────────────────────────────────────────── */
let fotoProducto = '';

async function cargarFotoProducto(e) {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    fotoProducto = await comprimirImagen(archivo, 640, 0.75);
    $('#prod-foto-vista').innerHTML = `<img src="${fotoProducto}" alt="">`;
    $('#prod-foto-quitar').hidden = false;
  } catch { aviso('No pudimos leer esa imagen.', 'error'); }
  e.target.value = '';
}
$('#prod-foto-archivo').addEventListener('change', cargarFotoProducto);
$('#prod-foto-camara').addEventListener('change', cargarFotoProducto);
$('#prod-foto-quitar').addEventListener('click', () => {
  fotoProducto = '';
  $('#prod-foto-vista').innerHTML = '<span>Sin foto</span>';
  $('#prod-foto-quitar').hidden = true;
});

$('#form-producto').addEventListener('submit', e => {
  e.preventDefault();
  const id = $('#prod-id').value;
  const codigo = $('#prod-codigo').value.trim();
  let numero = $('#prod-numero').value.trim();
  if (!numero) numero = siguienteNumero(productos);
  if (numero.length === 1) numero = '0' + numero;

  if (productos.some(p => p.numero === numero && p.id !== id))
    return aviso('Ya hay un producto con el número ' + numero + '.', 'error');
  if (codigo && productos.some(p => p.codigo === codigo && p.id !== id))
    return aviso('Ya existe un producto con ese código de barras.', 'error');

  const datos = {
    numero, codigo,
    nombre: $('#prod-nombre').value.trim(),
    precio: Number($('#prod-precio').value),
    categoria: $('#prod-categoria').value.trim(),
    foto: fotoProducto,
    activo: true
  };

  if (id) {
    const p = productos.find(x => x.id === id);
    Object.assign(p, datos, { activo: p.activo });
  } else {
    productos.push({ id: uid(), ...datos });
  }

  if (!guardar(K.productos, productos)) { refrescarProductos(); return; }
  limpiarFormProducto();
  pintarProductos(); pintarRejilla();
  aviso('Producto guardado', 'ok');
});

function limpiarFormProducto() {
  $('#form-producto').reset();
  $('#prod-id').value = '';
  fotoProducto = '';
  $('#prod-foto-vista').innerHTML = '<span>Sin foto</span>';
  $('#prod-foto-quitar').hidden = true;
  $('#prod-guardar').textContent = 'Agregar producto';
  $('#prod-cancelar').hidden = true;
}
$('#prod-cancelar').addEventListener('click', limpiarFormProducto);
$('#buscar-producto').addEventListener('input', pintarProductos);

function pintarProductos() {
  const q = $('#buscar-producto').value.trim().toLowerCase();
  const lista = productos.filter(p =>
    !q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q) || (p.numero || '').includes(q));

  $('#tabla-productos').innerHTML = `
    <thead><tr><th>Foto</th><th>N.º</th><th>Código de barras</th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td>${p.foto ? `<img class="mini-foto" src="${p.foto}" alt="">` : '<div class="mini-foto-vacia">·</div>'}</td>
        <td class="cod">${esc(p.numero)}</td>
        <td class="cod">${esc(p.codigo || '—')}</td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria || '—')}</td>
        <td class="num">${money(p.precio)}</td>
        <td>${p.activo === false ? '<span class="marca marca-inactivo">Oculto</span>' : '<span class="marca marca-ok">A la venta</span>'}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-editar-p="${p.id}">Editar</button>
          <button type="button" class="btn btn-fantasma mini" data-alternar-p="${p.id}">${p.activo === false ? 'Mostrar' : 'Ocultar'}</button>
          <button type="button" class="btn btn-fantasma mini" data-borrar-p="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="vacio">Aún no hay productos. Agrega el primero arriba.</td></tr>'}</tbody>`;
}

$('#tabla-productos').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;

  if (b.dataset.editarP) {
    const p = productos.find(x => x.id === b.dataset.editarP);
    $('#prod-id').value = p.id;
    $('#prod-numero').value = p.numero;
    $('#prod-codigo').value = p.codigo || '';
    $('#prod-nombre').value = p.nombre;
    $('#prod-precio').value = p.precio;
    $('#prod-categoria').value = p.categoria || '';
    fotoProducto = p.foto || '';
    $('#prod-foto-vista').innerHTML = fotoProducto ? `<img src="${fotoProducto}" alt="">` : '<span>Sin foto</span>';
    $('#prod-foto-quitar').hidden = !fotoProducto;
    $('#prod-guardar').textContent = 'Guardar cambios';
    $('#prod-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.alternarP) {
    const p = productos.find(x => x.id === b.dataset.alternarP);
    p.activo = p.activo === false;
    guardar(K.productos, productos); pintarProductos(); pintarRejilla();
  }
  if (b.dataset.borrarP) {
    if (!confirm('¿Borrar este producto? Los pedidos anteriores no cambian.')) return;
    productos = productos.filter(x => x.id !== b.dataset.borrarP);
    guardar(K.productos, productos);
    pintarProductos(); pintarRejilla(); aviso('Producto borrado', 'ok');
  }
});

$('#importar-productos').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const filas = (await archivo.text()).split(/\r?\n/).filter(l => l.trim());
  let indices = { numero: 0, codigo: 1, nombre: 2, precio: 3, categoria: 4 };
  let inicio = 0;

  const cabecera = filas[0].split(/[;,\t]/).map(c => c.trim().toLowerCase().replace(/^"|"$/g, ''));
  if (cabecera.some(c => ['numero', 'número', 'codigo', 'código', 'nombre'].includes(c))) {
    indices = {
      numero: cabecera.findIndex(c => c === 'numero' || c === 'número'),
      codigo: cabecera.findIndex(c => c === 'codigo' || c === 'código'),
      nombre: cabecera.findIndex(c => c === 'nombre'),
      precio: cabecera.findIndex(c => c === 'precio'),
      categoria: cabecera.findIndex(c => c === 'categoria' || c === 'categoría')
    };
    inicio = 1;
  }

  let nuevos = 0;
  for (let i = inicio; i < filas.length; i++) {
    const c = filas[i].split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, ''));
    const dato = k => (indices[k] >= 0 ? c[indices[k]] : '') || '';
    const nombre = dato('nombre'), precio = dato('precio');
    if (!nombre || isNaN(Number(precio))) continue;

    let numero = dato('numero');
    const codigo = dato('codigo');
    const existente = productos.find(p => (numero && p.numero === numero) || (codigo && p.codigo === codigo));
    if (existente) {
      Object.assign(existente, { nombre, precio: Number(precio), categoria: dato('categoria') || existente.categoria, codigo: codigo || existente.codigo });
    } else {
      if (!numero) numero = siguienteNumero(productos);
      if (numero.length === 1) numero = '0' + numero;
      productos.push({ id: uid(), numero, codigo, nombre, precio: Number(precio), categoria: dato('categoria'), foto: '', activo: true });
      nuevos++;
    }
  }
  guardar(K.productos, productos);
  pintarProductos(); pintarRejilla();
  aviso(`Importación lista. ${nuevos} productos nuevos.`, 'ok');
  e.target.value = '';
});

$('#exportar-productos').addEventListener('click', () => {
  const filas = [['numero', 'codigo', 'nombre', 'precio', 'categoria']].concat(
    productos.map(p => [p.numero, p.codigo || '', p.nombre, p.precio, p.categoria || '']));
  descargar('productos.csv', aCSV(filas), 'text/csv');
});

/* ── Usuarios ────────────────────────────────────────────── */
$('#form-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#usr-id').value;
  const cedula = $('#usr-cedula').value.trim();
  const clave = $('#usr-clave').value.trim();
  const usuarios = leerUsuarios();

  if (usuarios.some(u => u.cedula === cedula && u.id !== id))
    return aviso('Ya hay alguien con esa identificación.', 'error');
  if (!id && clave.length < 4)
    return aviso('La contraseña necesita al menos 4 dígitos.', 'error');

  let afectado;
  if (id) {
    afectado = usuarios.find(x => x.id === id);
    afectado.nombre = $('#usr-nombre').value.trim();
    afectado.cedula = cedula;
    afectado.correo = $('#usr-correo').value.trim();
    afectado.rol = $('#usr-rol').value;
    afectado.debeCambiar = $('#usr-cambiar').checked;
    if (clave) { afectado.sal = uid(); afectado.clave = await hashClave(clave, afectado.sal); }
  } else {
    const sal = uid();
    afectado = {
      id: uid(), nombre: $('#usr-nombre').value.trim(), cedula,
      correo: $('#usr-correo').value.trim(), rol: $('#usr-rol').value,
      sal, clave: await hashClave(clave, sal), activo: true,
      debeCambiar: $('#usr-cambiar').checked, creado: new Date().toISOString()
    };
    usuarios.push(afectado);
  }

  // Todo administrador necesita su propio código de recuperación
  let codigo = null;
  if (afectado.rol === 'admin' && !afectado.recuperacion) codigo = await asignarCodigo(afectado);

  guardar(K.usuarios, usuarios);
  limpiarFormUsuario();
  pintarUsuarios();

  if (codigo) {
    mostrarCodigo(codigo, {
      titulo: 'Código de recuperación del administrador',
      texto: 'Entrégaselo a esta persona. Le servirá para cambiar su contraseña si la olvida.',
      extra: [['Identificación', afectado.cedula], ['Nombre', afectado.nombre]]
    });
  } else {
    aviso('Usuario guardado', 'ok');
  }
});

function limpiarFormUsuario() {
  $('#form-usuario').reset();
  $('#usr-id').value = '';
  $('#usr-clave').value = config.claveGenerica || '';
  $('#usr-cambiar').checked = true;
  $('#usr-guardar').textContent = 'Crear usuario';
  $('#usr-clave').placeholder = 'Mínimo 4 dígitos';
  $('#usr-cancelar').hidden = true;
}
$('#usr-cancelar').addEventListener('click', limpiarFormUsuario);
$('#buscar-usuario').addEventListener('input', pintarUsuarios);

function pintarUsuarios() {
  const q = $('#buscar-usuario').value.trim().toLowerCase();
  const pedidos = leerPedidos();
  const lista = leerUsuarios().filter(u =>
    !q || u.nombre.toLowerCase().includes(q) || u.cedula.includes(q));

  $('#tabla-usuarios').innerHTML = `
    <thead><tr><th>Identificación</th><th>Nombre</th><th>Correo</th><th>Rol</th><th class="num">Pedidos</th><th class="num">Pendiente nómina</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(u => {
      const mios = pedidos.filter(p => p.usuarioId === u.id);
      const deuda = mios.filter(p => p.metodo === 'nomina' && p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
      return `<tr>
        <td class="cod">${esc(u.cedula)}</td>
        <td>${esc(u.nombre)}</td>
        <td>${esc(u.correo || '—')}</td>
        <td>${u.rol === 'admin' ? 'Administrador' : 'Empleado'}</td>
        <td class="num">${mios.length}</td>
        <td class="num">${money(deuda)}</td>
        <td>${u.activo === false ? '<span class="marca marca-inactivo">Inactivo</span>' : '<span class="marca marca-ok">Activo</span>'}${u.debeCambiar ? '<br><span class="marca marca-pendiente">Clave genérica</span>' : ''}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-editar-u="${u.id}">Editar</button>
          ${u.rol === 'admin' ? `<button type="button" class="btn btn-fantasma mini" data-codigo-u="${u.id}">Código nuevo</button>` : ''}
          <button type="button" class="btn btn-fantasma mini" data-alternar-u="${u.id}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>`;
}

$('#tabla-usuarios').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const usuarios = leerUsuarios();
  if (b.dataset.codigoU) {
    if (!confirm('Se generará un código nuevo y el anterior dejará de servir. ¿Continuar?')) return;
    const u = usuarios.find(x => x.id === b.dataset.codigoU);
    const codigo = await asignarCodigo(u);
    if (!guardar(K.usuarios, usuarios)) return;
    mostrarCodigo(codigo, {
      titulo: 'Código de recuperación nuevo',
      texto: 'El código anterior ya no sirve. Guarda este en su lugar.',
      extra: [['Identificación', u.cedula], ['Nombre', u.nombre]]
    });
    return;
  }
  if (b.dataset.editarU) {
    const u = usuarios.find(x => x.id === b.dataset.editarU);
    $('#usr-id').value = u.id; $('#usr-nombre').value = u.nombre;
    $('#usr-cedula').value = u.cedula; $('#usr-rol').value = u.rol;
    $('#usr-correo').value = u.correo || '';
    $('#usr-cambiar').checked = !!u.debeCambiar;
    $('#usr-clave').value = ''; $('#usr-clave').placeholder = 'Déjala vacía para no cambiarla';
    $('#usr-guardar').textContent = 'Guardar cambios';
    $('#usr-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.alternarU) {
    const u = usuarios.find(x => x.id === b.dataset.alternarU);
    if (u.id === usuario.id) return aviso('No puedes desactivar tu propio usuario.', 'error');
    u.activo = u.activo === false;
    guardar(K.usuarios, usuarios); pintarUsuarios();
  }
});

$('#exportar-usuarios').addEventListener('click', () => {
  const filas = [['identificacion', 'nombre', 'correo', 'rol', 'activo']].concat(
    leerUsuarios().map(u => [u.cedula, u.nombre, u.correo || '', u.rol, u.activo === false ? 'no' : 'si']));
  descargar('usuarios.csv', aCSV(filas), 'text/csv');
});

/* ── Cambios de estado (solo administrador) ──────────────── */
function cambiarEstado(id, accion) {
  if (usuario?.rol !== 'admin') return aviso('Solo el administrador puede cambiar el estado.', 'error');
  const pedidos = leerPedidos();
  const p = pedidos.find(x => x.id === id); if (!p) return;
  p.historial = p.historial || [];

  const registrar = texto => p.historial.push({ fecha: new Date().toISOString(), texto, por: usuario.nombre });

  if (accion === 'verificar') { p.estado = 'verificado'; registrar('Pago verificado con el soporte'); }
  if (accion === 'anomina') {
    if (!confirm('El pago no se pudo verificar. ¿Pasar este pedido a descuento de nómina?')) return;
    p.metodo = 'nomina'; p.estado = 'pendiente';
    registrar('Pago sin verificar, pasa a descuento de nómina');
  }
  if (accion === 'conciliar') { p.estado = 'conciliado'; registrar('Descontado de nómina'); }
  if (accion === 'reabrir') {
    p.estado = p.metodo === 'nomina' ? 'pendiente' : 'aprobado';
    registrar('Reabierto');
  }
  if (accion === 'borrar') {
    if (!confirm('¿Borrar este pedido? No se puede deshacer.')) return;
    guardar(K.pedidos, pedidos.filter(x => x.id !== id));
    pintarPedidos(); pintarVerificacion(); aviso('Pedido borrado', 'ok');
    return;
  }

  guardar(K.pedidos, pedidos);
  pintarPedidos(); pintarVerificacion();
  aviso('Pedido actualizado', 'ok');
}

function botonesPedido(p) {
  const b = [];
  if (p.estado === 'aprobado') {
    b.push(['verificar', 'Verificar'], ['anomina', 'Pasar a nómina']);
  } else if (p.estado === 'pendiente') {
    b.push(['conciliar', 'Marcar descontado']);
  } else {
    b.push(['reabrir', 'Reabrir']);
  }
  b.push(['borrar', 'Borrar']);
  return b.map(([a, t]) => `<button type="button" class="btn btn-fantasma mini" data-accion="${a}" data-id="${p.id}">${t}</button>`).join('');
}

/* ── Pedidos ─────────────────────────────────────────────── */
['#f-desde', '#f-hasta', '#f-metodo', '#f-estado', '#f-persona']
  .forEach(s => $(s).addEventListener('input', pintarPedidos));

function pedidosFiltrados() {
  const desde = $('#f-desde').value, hasta = $('#f-hasta').value;
  const metodo = $('#f-metodo').value, estado = $('#f-estado').value;
  const q = $('#f-persona').value.trim().toLowerCase();
  return leerPedidos().filter(p => {
    const d = p.creado.slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    if (metodo && p.metodo !== metodo) return false;
    if (estado && p.estado !== estado) return false;
    if (q && !(p.nombre.toLowerCase().includes(q) || p.cedula.includes(q))) return false;
    return true;
  }).sort((a, b) => b.creado.localeCompare(a.creado));
}

function pintarPedidos() {
  const lista = pedidosFiltrados();
  const total = lista.reduce((s, p) => s + p.total, 0);
  const nomina = lista.filter(p => p.metodo === 'nomina').reduce((s, p) => s + p.total, 0);
  const sinVerificar = lista.filter(p => p.estado === 'aprobado').reduce((s, p) => s + p.total, 0);

  $('#resumen-pedidos').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${lista.length}</b></div>
    <div><span class="eyebrow">Total vendido</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Para nómina</span><b>${money(nomina)}</b></div>
    <div><span class="eyebrow">Pago inmediato</span><b>${money(total - nomina)}</b></div>
    <div><span class="eyebrow">Sin verificar</span><b>${money(sinVerificar)}</b></div>`;

  const porPersona = {};
  lista.filter(p => p.metodo === 'nomina' && p.estado === 'pendiente').forEach(p => {
    porPersona[p.cedula] = porPersona[p.cedula] || { nombre: p.nombre, cedula: p.cedula, pedidos: 0, total: 0 };
    porPersona[p.cedula].pedidos++; porPersona[p.cedula].total += p.total;
  });
  const resumen = Object.values(porPersona).sort((a, b) => b.total - a.total);

  $('#tabla-nomina').innerHTML = `
    <thead><tr><th>Identificación</th><th>Nombre</th><th class="num">Pedidos</th><th class="num">Total a descontar</th><th></th></tr></thead>
    <tbody>${resumen.length ? resumen.map(r => `
      <tr><td class="cod">${esc(r.cedula)}</td><td>${esc(r.nombre)}</td>
      <td class="num">${r.pedidos}</td><td class="num">${money(r.total)}</td>
      <td><div class="tabla-acciones"><button type="button" class="btn btn-fantasma mini" data-conciliar="${esc(r.cedula)}">Marcar descontado</button></div></td></tr>`).join('')
      : '<tr><td colspan="5" class="vacio">No hay valores pendientes de descuento en este filtro.</td></tr>'}</tbody>`;

  $('#tabla-pedidos').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Persona</th><th>Productos</th><th>Método</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${esc(p.nombre)}<br><span class="cod">${esc(p.cedula)}</span></td>
        <td>${p.items.map(i => `${i.cantidad}× ${esc(i.nombre)}`).join('<br>')}</td>
        <td><span class="marca marca-${p.metodo}">${p.metodo === 'nomina' ? 'Nómina' : 'Inmediato'}</span>${p.referencia ? `<br><span class="cod">${esc(p.referencia)}</span>` : ''}</td>
        <td class="num">${money(p.total)}</td>
        <td>${marcaEstado(p.estado)}${(p.historial || []).length ? `<br><small>${esc(p.historial[p.historial.length - 1].texto)}</small>` : ''}</td>
        <td><div class="tabla-acciones">${botonesPedido(p)}</div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="vacio">No hay pedidos con estos filtros.</td></tr>'}</tbody>`;
}

$('#tabla-nomina').addEventListener('click', e => {
  const b = e.target.closest('[data-conciliar]'); if (!b) return;
  if (usuario?.rol !== 'admin') return;
  if (!confirm('¿Marcar como descontados todos los pedidos pendientes de esta persona?')) return;
  const pedidos = leerPedidos();
  pedidos.forEach(p => {
    if (p.cedula === b.dataset.conciliar && p.metodo === 'nomina' && p.estado === 'pendiente') {
      p.estado = 'conciliado';
      (p.historial = p.historial || []).push({ fecha: new Date().toISOString(), texto: 'Descontado de nómina', por: usuario.nombre });
    }
  });
  guardar(K.pedidos, pedidos); pintarPedidos(); aviso('Pedidos conciliados', 'ok');
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-accion][data-id]');
  if (!b) return;
  cambiarEstado(b.dataset.id, b.dataset.accion);
});

/* ── Verificación de pagos ───────────────────────────────── */
async function subirSoporte(e) {
  const archivo = e.target.files[0]; if (!archivo) return;
  const esPDF = archivo.type === 'application/pdf';
  try {
    let datos;
    if (esPDF) {
      if (archivo.size > 2_000_000) { aviso('El PDF debe pesar menos de 2 MB.', 'error'); e.target.value = ''; return; }
      datos = await leerArchivo(archivo);
    } else {
      datos = await comprimirImagen(archivo, 1400, 0.72);
    }
    const soportes = leerSoportes();
    soportes.unshift({
      id: uid(), nombre: archivo.name, tipo: esPDF ? 'pdf' : 'imagen',
      nota: $('#sop-nota').value.trim(), datos, creado: new Date().toISOString()
    });
    if (guardar(K.soportes, soportes)) {
      $('#sop-nota').value = '';
      pintarVerificacion();
      aviso('Soporte cargado', 'ok');
    }
  } catch { aviso('No pudimos leer ese archivo.', 'error'); }
  e.target.value = '';
}
$('#sop-archivo').addEventListener('change', subirSoporte);
$('#sop-camara').addEventListener('change', subirSoporte);

function pintarVerificacion() {
  const soportes = leerSoportes();
  $('#lista-soportes').innerHTML = soportes.length ? soportes.map(s => `
    <div class="soporte">
      <div class="soporte-vista">${s.tipo === 'imagen' ? `<img src="${s.datos}" alt="">` : '<span class="pdf">PDF</span>'}</div>
      <div class="soporte-pie">
        <b>${esc(s.nota || s.nombre)}</b>
        <small>${fecha(s.creado)}</small>
        <div class="soporte-acciones">
          <button type="button" class="btn btn-fantasma mini" data-ver-soporte="${s.id}">Abrir</button>
          <button type="button" class="btn btn-fantasma mini" data-borrar-soporte="${s.id}">Borrar</button>
        </div>
      </div>
    </div>`).join('') : '<p class="vacio">Todavía no has subido soportes.</p>';

  const porVerificar = leerPedidos()
    .filter(p => p.metodo === 'qr' && p.estado === 'aprobado')
    .sort((a, b) => b.creado.localeCompare(a.creado));

  $('#tabla-verificar').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Persona</th><th>Referencia</th><th class="num">Total</th><th></th></tr></thead>
    <tbody>${porVerificar.length ? porVerificar.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${esc(p.nombre)}<br><span class="cod">${esc(p.cedula)}</span></td>
        <td class="cod">${esc(p.referencia || '—')}</td>
        <td class="num">${money(p.total)}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-accion="verificar" data-id="${p.id}">Verificar</button>
          <button type="button" class="btn btn-fantasma mini" data-accion="anomina" data-id="${p.id}">Pasar a nómina</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6" class="vacio">No hay pagos pendientes de verificación.</td></tr>'}</tbody>`;
}

$('#lista-soportes').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const soportes = leerSoportes();
  if (b.dataset.verSoporte) {
    const s = soportes.find(x => x.id === b.dataset.verSoporte);
    abrirDataURL(s.datos, s.nombre);
  }
  if (b.dataset.borrarSoporte) {
    if (!confirm('¿Borrar este soporte?')) return;
    guardar(K.soportes, soportes.filter(x => x.id !== b.dataset.borrarSoporte));
    pintarVerificacion(); aviso('Soporte borrado', 'ok');
  }
});

/* ── CSV y correo ────────────────────────────────────────── */
function aCSV(filas) {
  return '\uFEFF' + filas.map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvPedidos(lista) {
  const filas = [['codigo_pedido', 'fecha', 'identificacion', 'nombre', 'metodo', 'estado', 'referencia',
                  'numero', 'codigo_barras', 'producto', 'precio_unitario', 'cantidad', 'subtotal', 'total_pedido']];
  lista.forEach(p => p.items.forEach(i => filas.push([
    p.folio, fecha(p.creado), p.cedula, p.nombre,
    p.metodo === 'nomina' ? 'Nómina' : 'Pago inmediato',
    (ESTADOS[p.estado] || {}).texto || p.estado, p.referencia || '',
    i.numero || '', i.codigo || '', i.nombre, i.precio, i.cantidad, i.precio * i.cantidad, p.total
  ])));
  return aCSV(filas);
}

$('#exportar-pedidos').addEventListener('click', () => {
  descargar(`pedidos_${hoy()}.csv`, csvPedidos(pedidosFiltrados()), 'text/csv');
});

$('#enviar-correo').addEventListener('click', async () => {
  const lista = pedidosFiltrados();
  if (!lista.length) return aviso('No hay pedidos para enviar con estos filtros.', 'error');
  if (!config.correo) return aviso('Escribe el correo de la empresa en Ajustes.', 'error');

  const csv = csvPedidos(lista);
  const total = lista.reduce((s, p) => s + p.total, 0);
  const nomina = lista.filter(p => p.metodo === 'nomina').reduce((s, p) => s + p.total, 0);
  const sinVerificar = lista.filter(p => p.estado === 'aprobado').reduce((s, p) => s + p.total, 0);
  const asunto = `Reporte de la tienda interna · ${hoy()}`;
  const cuerpo =
`Reporte de ${config.empresa}
Generado: ${new Date().toLocaleString('es-CO')}
Pedidos: ${lista.length}
Total vendido: ${money(total)}
Para descuento de nómina: ${money(nomina)}
Pago inmediato: ${money(total - nomina)}
Pagos sin verificar: ${money(sinVerificar)}`;

  if (config.usarFuncion) {
    try {
      const r = await fetch('/.netlify/functions/enviar-reporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ para: config.correo, asunto, cuerpo, csv, nombreArchivo: `pedidos_${hoy()}.csv` })
      });
      if (!r.ok) throw new Error();
      return aviso('Reporte enviado a ' + config.correo, 'ok');
    } catch {
      aviso('No se pudo enviar automáticamente. Se descargará el archivo.', 'error');
    }
  }

  descargar(`pedidos_${hoy()}.csv`, csv, 'text/csv');
  window.location.href = `mailto:${encodeURIComponent(config.correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo + '\n\nAdjunta el archivo que se acaba de descargar.')}`;
});

/* ── Ajustes ─────────────────────────────────────────────── */
function pintarAjustes() {
  $('#cfg-empresa').value = config.empresa;
  $('#cfg-correo').value = config.correo;
  $('#cfg-codigo').value = config.codigoCorto;
  $('#cfg-instrucciones').value = config.instrucciones;
  $('#cfg-moneda').value = config.moneda;
  $('#cfg-funcion').checked = !!config.usarFuncion;
  $('#cfg-generica').value = config.claveGenerica || '';
  $('#cfg-correo-recuperacion').checked = !!config.correoRecuperacion;
  $('#cfg-qr-vista').innerHTML = config.qr ? `<img src="${config.qr}" alt="Código QR de pago">` : '';
}

$('#cfg-qr-archivo').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    config.qr = await comprimirImagen(archivo, 700, 0.85);
    $('#cfg-qr-vista').innerHTML = `<img src="${config.qr}" alt="Código QR de pago">`;
    aviso('Imagen cargada. Guarda los ajustes.', 'ok');
  } catch { aviso('No pudimos leer esa imagen.', 'error'); }
  e.target.value = '';
});

$('#form-ajustes').addEventListener('submit', e => {
  e.preventDefault();
  Object.assign(config, {
    empresa: $('#cfg-empresa').value.trim() || 'Tienda interna',
    correo: $('#cfg-correo').value.trim(),
    codigoCorto: $('#cfg-codigo').value.trim(),
    instrucciones: $('#cfg-instrucciones').value.trim(),
    moneda: $('#cfg-moneda').value,
    usarFuncion: $('#cfg-funcion').checked,
    claveGenerica: $('#cfg-generica').value.trim() || '1234',
    correoRecuperacion: $('#cfg-correo-recuperacion').checked
  });
  guardar(K.config, config);
  $('#marca-empresa').textContent = config.empresa;
  document.title = config.empresa;
  pintarCarrito(); pintarRejilla();
  aviso('Ajustes guardados', 'ok');
});

/* ── Respaldo ────────────────────────────────────────────── */
function pintarEspacio() {
  let bytes = 0;
  Object.values(K).forEach(k => { bytes += (localStorage.getItem(k) || '').length; });
  const mb = (bytes / 1048576).toFixed(2);
  $('#uso-espacio').textContent = `Espacio ocupado: ${mb} MB de unos 5 MB disponibles. Las fotos y los soportes son lo que más pesa.`;
}

$('#respaldo-descargar').addEventListener('click', () => {
  const copia = {
    version: 2, generado: new Date().toISOString(),
    usuarios: leerUsuarios(), productos, pedidos: leerPedidos(), soportes: leerSoportes(), config
  };
  descargar(`respaldo_tienda_${hoy()}.json`, JSON.stringify(copia), 'application/json');
});

$('#respaldo-cargar').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    const d = JSON.parse(await archivo.text());
    if (!d.usuarios || !d.productos) throw new Error('formato');
    if (!confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
    guardar(K.usuarios, d.usuarios); guardar(K.productos, d.productos);
    guardar(K.pedidos, d.pedidos || []); guardar(K.soportes, d.soportes || []);
    guardar(K.config, { ...CONFIG_BASE, ...(d.config || {}) });
    aviso('Copia restaurada. La página se recargará.', 'ok');
    setTimeout(() => location.reload(), 1200);
  } catch { aviso('Ese archivo no es una copia válida.', 'error'); }
  e.target.value = '';
});

$('#borrar-pedidos').addEventListener('click', () => {
  if (!confirm('¿Borrar los pedidos verificados y los ya descontados?')) return;
  guardar(K.pedidos, leerPedidos().filter(p => !['conciliado', 'verificado'].includes(p.estado)));
  pintarPedidos(); pintarVerificacion(); pintarEspacio();
  aviso('Pedidos cerrados borrados', 'ok');
});

$('#borrar-soportes').addEventListener('click', () => {
  if (!confirm('¿Borrar todos los soportes cargados?')) return;
  guardar(K.soportes, []);
  pintarVerificacion(); pintarEspacio();
  aviso('Soportes borrados', 'ok');
});

/* ── Arranque ────────────────────────────────────────────── */
(async function arrancar() {
  await inicializarDatos();
  prepararTecladoLogin();
  prepararTecladoNumero();

  $('#marca-empresa').textContent = config.empresa;
  document.title = config.empresa;

  const s = LS.get(K.sesion, null);
  const u = s && leerUsuarios().find(x => x.id === s.id && x.activo !== false);
  if (u && Date.now() - s.ts < 12 * 60 * 60 * 1000) abrirSesion(u);
  else mostrar('pantalla-login');

  pintarCarrito();

  if (codigoInicial) {
    mostrarCodigo(codigoInicial, {
      titulo: 'Datos de acceso del administrador',
      texto: 'Esta tableta se acaba de configurar. Cambia la contraseña apenas entres y guarda el código de recuperación.',
      extra: [['Identificación', '0000'], ['Contraseña inicial', '1234']]
    });
    codigoInicial = null;
  }
})();
