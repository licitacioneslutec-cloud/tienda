/* ═══════════════════════════════════════════════════════════
   Tienda interna · versión 4
   Los datos viven en Firebase Realtime Database, así que todos
   los celulares ven lo mismo en tiempo real.
   Único método de pago: descuento de nómina.
   ═══════════════════════════════════════════════════════════ */

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, get, set, update, remove, runTransaction,
  query, orderByChild, equalTo
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const auth = getAuth(app);

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoy = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const listar = obj => Object.values(obj || {});

function folioNuevo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let f = '';
  for (let i = 0; i < 6; i++) f += letras[Math.floor(Math.random() * letras.length)];
  return f.slice(0, 3) + '-' + f.slice(3);
}

const ESTADOS = {
  pendiente : { texto: 'Pendiente de descuento', clase: 'pendiente' },
  conciliado: { texto: 'Descontado',             clase: 'ok' }
};
const marcaEstado = e => {
  const i = ESTADOS[e] || { texto: e, clase: 'inactivo' };
  return `<span class="marca marca-${i.clase}">${i.texto}</span>`;
};

/* ── Estado en memoria, alimentado por Firebase ──────────── */
const datos = { config: {}, usuarios: {}, productos: {}, fotos: {}, pedidos: {}, movimientos: {} };
let usuario = null;
let carrito = [];
let escuchandoAdmin = false;

const CONFIG_BASE = {
  empresa: 'Tienda interna', correo: '', moneda: 'COP',
  claveGenerica: '1234', webhook: '', token: ''
};

const money = n => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: datos.config.moneda || 'COP', maximumFractionDigits: 0
}).format(Number(n) || 0);
const fecha = iso => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const fechaCorta = iso => new Date(iso).toLocaleDateString('es-CO');

function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = 'aviso ' + (tipo ? 'aviso-' + tipo : '');
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), 4000);
}

async function hashClave(clave, sal) {
  const txt = sal + '::' + clave;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error('script'));
    document.head.append(s);
  });
}

/* ── Acceso a la base ────────────────────────────────────── */
const guardarNodo = (ruta, valor) => set(ref(db, ruta), valor);
const actualizar  = (ruta, cambios) => update(ref(db, ruta), cambios);
const borrarNodo  = (ruta) => remove(ref(db, ruta));

function escuchar(ruta, alCambiar) {
  onValue(ref(db, ruta), snap => alCambiar(snap.val() || {}),
    err => aviso('Error leyendo ' + ruta + ': ' + err.message, 'error'));
}

async function conError(promesa, queHacia) {
  try { await promesa; return true; }
  catch (err) {
    aviso(`No se pudo ${queHacia}: ${err.message}`, 'error');
    return false;
  }
}

/* ── Pantallas ───────────────────────────────────────────── */
function mostrar(id) {
  $$('.pantalla').forEach(p => p.classList.remove('activa'));
  $('#' + id).classList.add('activa');
  window.scrollTo({ top: 0 });
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

let campoLogin = null;
montarTeclado($('#teclado-login'), {
  etiqueta: 'OK',
  onDigito: d => { (campoLogin || $('#login-cedula')).value += d; },
  onBorrar: () => { const c = campoLogin || $('#login-cedula'); c.value = c.value.slice(0, -1); },
  onOk: () => {
    if (campoLogin !== $('#login-clave') && $('#login-cedula').value) $('#login-clave').focus();
    else $('#form-login').requestSubmit();
  }
});
[$('#login-cedula'), $('#login-clave')].forEach(i =>
  i.addEventListener('focus', () => { campoLogin = i; }));
campoLogin = $('#login-cedula');

let numeroBuffer = '';
montarTeclado($('#teclado-numero'), {
  etiqueta: 'Agregar',
  onDigito: d => { if (numeroBuffer.length < 6) numeroBuffer += d; $('#visor-numero').textContent = numeroBuffer; },
  onBorrar: () => { numeroBuffer = numeroBuffer.slice(0, -1); $('#visor-numero').textContent = numeroBuffer || '—'; },
  onOk: () => {
    if (!numeroBuffer) return aviso('Escribe el número del producto.', 'error');
    if (agregarPorCodigo(numeroBuffer)) { numeroBuffer = ''; $('#visor-numero').textContent = '—'; }
  }
});

$('#btn-teclado').addEventListener('click', () => {
  const b = $('#buscador');
  b.hidden = !b.hidden;
  numeroBuffer = ''; $('#visor-numero').textContent = '—';
});
$('#cerrar-buscador').addEventListener('click', () => { $('#buscador').hidden = true; });

/* ── Ingreso ─────────────────────────────────────────────── */
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const cedula = $('#login-cedula').value.trim();
  const clave  = $('#login-clave').value;
  if (!cedula || !clave) return aviso('Faltan datos.', 'error');

  let ficha;
  try {
    ficha = (await get(ref(db, 'usuarios/' + cedula))).val();
  } catch (err) {
    return aviso('No hay conexión con la base: ' + err.message, 'error');
  }
  if (!ficha || ficha.activo === false) return aviso('Esa cédula no está registrada.', 'error');
  if (await hashClave(clave, ficha.sal) !== ficha.clave) return aviso('La clave no coincide.', 'error');

  abrirSesion(ficha);
});

function abrirSesion(ficha) {
  usuario = ficha;
  localStorage.setItem('ti_sesion', JSON.stringify({ cedula: ficha.cedula, ts: Date.now() }));
  $('#tienda-usuario').textContent = ficha.nombre.split(' ')[0];
  $('#admin-usuario').textContent  = ficha.nombre;
  $('#btn-ir-admin').hidden = ficha.rol !== 'admin';
  carrito = [];
  pintarCarrito();
  pintarRejilla();
  cargarMisPedidos();
  mostrar('pantalla-tienda');
  if (ficha.debeCambiar) setTimeout(() => abrirCambioClave(true), 300);
}

function cerrarSesion() {
  usuario = null; carrito = [];
  localStorage.removeItem('ti_sesion');
  $('#form-login').reset();
  $('#buscador').hidden = true;
  mostrar('pantalla-login');
}

$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-salir-admin').addEventListener('click', cerrarSesion);
$('#btn-volver-tienda').addEventListener('click', () => mostrar('pantalla-tienda'));
$('#btn-ir-admin').addEventListener('click', () => {
  if (usuario?.rol !== 'admin') return;
  escucharComoAdmin();
  mostrar('pantalla-admin');
  pintarProductos();
  const bajos = productosBajos();
  if (bajos.length) aviso(`${bajos.length} producto(s) por reponer. Revisa Inventario.`, 'error');
});

/* ── Productos y carrito ─────────────────────────────────── */
const productosLista = () => listar(datos.productos);
const fotoDe = numero => datos.fotos[numero] || '';

function buscarProducto(valor) {
  const v = String(valor).trim();
  return productosLista().find(p => p.activo !== false && (
    p.codigo === v || p.numero === v ||
    (v !== '' && !isNaN(v) && !isNaN(p.numero) && Number(p.numero) === Number(v))
  ));
}

function agregarPorCodigo(codigo) {
  const p = buscarProducto(codigo);
  if (!p) { aviso('No hay ningún producto con ese código: ' + codigo, 'error'); return false; }
  agregarProducto(p); return true;
}

function agregarProducto(p) {
  const item = carrito.find(i => i.numero === p.numero);
  const enCarrito = item ? item.cantidad : 0;
  const quedan = Number(p.stock || 0);

  if (p.bloquear !== false && enCarrito + 1 > quedan) {
    aviso(quedan <= 0 ? `${p.nombre} está agotado.` : `Solo quedan ${quedan} de ${p.nombre}.`, 'error');
    return;
  }
  if (item) item.cantidad++;
  else carrito.push({ numero: p.numero, codigo: p.codigo || '', nombre: p.nombre, precio: Number(p.precio), cantidad: 1 });
  pintarCarrito();
  aviso(p.nombre + ' agregado', 'ok');
}

const totalCarrito = () => carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

function miniatura(numero) {
  const f = fotoDe(numero);
  return f ? `<img class="mini-foto" src="${f}" alt="">`
           : `<div class="mini-foto-vacia">${esc(numero || '·')}</div>`;
}

function pintarCarrito() {
  const ul = $('#lista-carrito');
  ul.innerHTML = carrito.length ? '' : '<li class="vacio">Todavía no has agregado nada.</li>';
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
  $('#btn-pagar-nomina').disabled = carrito.length === 0;
}

$('#lista-carrito').addEventListener('click', e => {
  const mas = e.target.dataset.mas, menos = e.target.dataset.menos;
  if (mas !== undefined) {
    const i = carrito[+mas];
    const p = datos.productos[i.numero];
    if (p && p.bloquear !== false && i.cantidad + 1 > Number(p.stock || 0))
      return aviso(`Solo quedan ${Number(p.stock || 0)} de ${p.nombre}.`, 'error');
    i.cantidad++;
  }
  if (menos !== undefined && --carrito[+menos].cantidad <= 0) carrito.splice(+menos, 1);
  if (mas !== undefined || menos !== undefined) pintarCarrito();
});

$('#btn-vaciar').addEventListener('click', () => { carrito = []; pintarCarrito(); });

$('#entrada-codigo').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim();
  if (v && agregarPorCodigo(v)) e.target.value = '';
});
$('#entrada-codigo').addEventListener('input', pintarRejilla);

function pintarRejilla() {
  const cont = $('#rejilla-productos');
  if (!cont) return;
  const q = ($('#entrada-codigo').value || '').trim().toLowerCase();
  const lista = productosLista()
    .filter(p => p.activo !== false)
    .filter(p => !q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q) || (p.numero || '').includes(q))
    .sort((a, b) => (a.numero || '').localeCompare(b.numero || '', 'es', { numeric: true }));

  cont.innerHTML = '';
  if (!lista.length) {
    cont.innerHTML = '<p class="vacio">No hay productos que coincidan.</p>';
    return;
  }
  lista.forEach(p => {
    const quedan = Number(p.stock || 0);
    const agotado = p.bloquear !== false && quedan <= 0;
    const foto = fotoDe(p.numero);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'producto' + (agotado ? ' agotado' : '');
    b.disabled = agotado;
    const etiqueta = agotado ? 'Agotado'
      : (quedan > 0 && quedan <= Number(p.minimo || 0) ? `Quedan ${quedan}` : '');
    b.innerHTML = `
      <div class="producto-foto">
        ${foto ? `<img src="${foto}" alt="" loading="lazy">` : '<span class="sinfoto">◻</span>'}
        <span class="producto-num">${esc(p.numero)}</span>
        ${etiqueta ? `<span class="producto-stock">${etiqueta}</span>` : ''}
      </div>
      <div class="producto-info"><b>${esc(p.nombre)}</b><span>${money(p.precio)}</span></div>`;
    b.addEventListener('click', () => agregarProducto(p));
    cont.append(b);
  });
}

/* ── Cámara ──────────────────────────────────────────────── */
let flujoCamara = null, bucleCamara = null, lectorZX = null;

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
      estado.textContent = 'No pudimos abrir la cámara. Revisa los permisos del navegador.';
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

  try {
    estado.textContent = 'Preparando el lector…';
    if (!window.ZXing) await cargarScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
    lectorZX = new window.ZXing.BrowserMultiFormatReader();
    await lectorZX.decodeFromVideoDevice(null, video, r => { if (r) codigoCapturado(r.getText()); });
    estado.textContent = 'Apunta al código de barras.';
  } catch {
    estado.textContent = 'Este teléfono no permite escanear. Usa el número del producto.';
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
}

/* ── Modales ─────────────────────────────────────────────── */
function abrirModal(id) { $('#' + id).classList.add('abierto'); }
function cerrarModal(id) {
  if (id === 'modal-camara') detenerCamara();
  $('#' + id).classList.remove('abierto');
}
$$('[data-cerrar]').forEach(b => b.addEventListener('click', e => cerrarModal(e.target.closest('.modal').id)));
$$('.modal').forEach(m => m.addEventListener('click', e => {
  if (e.target === m && !m.classList.contains('fijo')) cerrarModal(m.id);
}));

/* ── Confirmar pedido ────────────────────────────────────── */
let misPedidos = [];

function cargarMisPedidos() {
  if (!usuario) return;
  const q = query(ref(db, 'pedidos'), orderByChild('cedula'), equalTo(usuario.cedula));
  onValue(q, snap => { misPedidos = listar(snap.val()); }, () => {});
}

$('#btn-pagar-nomina').addEventListener('click', () => {
  $('#nomina-total').textContent = money(totalCarrito());
  const acum = misPedidos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
  $('#nomina-acumulado').textContent = acum
    ? `Ya tienes ${money(acum)} pendientes de descuento este período.`
    : 'Es tu primer pedido pendiente de descuento este período.';
  $('#nomina-acepto').checked = false;
  abrirModal('modal-nomina');
});

$('#nomina-confirmar').addEventListener('click', async () => {
  if (!$('#nomina-acepto').checked) return aviso('Marca la autorización para continuar.', 'error');
  const boton = $('#nomina-confirmar');
  boton.disabled = true;
  try { await guardarPedido(); } finally { boton.disabled = false; }
});

async function guardarPedido() {
  // Primero se apartan las unidades, para que dos personas a la vez no
  // se lleven el mismo último producto.
  const apartados = [];
  for (const i of carrito) {
    const p = datos.productos[i.numero];
    const resultado = await runTransaction(ref(db, `productos/${i.numero}/stock`), actual => {
      const s = Number(actual || 0);
      if (p && p.bloquear !== false && s < i.cantidad) return; // aborta
      return s - i.cantidad;
    });
    if (!resultado.committed) {
      // Devolver lo ya apartado
      for (const a of apartados) {
        await runTransaction(ref(db, `productos/${a.numero}/stock`), s => Number(s || 0) + a.cantidad);
      }
      cerrarModal('modal-nomina');
      aviso(`Alguien se adelantó: ya no hay suficiente ${i.nombre}.`, 'error');
      return;
    }
    apartados.push(i);
  }

  const id = uid();
  const pedido = {
    id, folio: folioNuevo(),
    cedula: usuario.cedula, nombre: usuario.nombre,
    items: carrito.map(i => ({ ...i })),
    total: totalCarrito(),
    estado: 'pendiente',
    creado: new Date().toISOString()
  };

  const ok = await conError(guardarNodo('pedidos/' + id, pedido), 'guardar el pedido');
  if (!ok) return;

  for (const i of carrito) {
    const saldo = Number(datos.productos[i.numero]?.stock || 0);
    registrarMovimiento({
      numero: i.numero, producto: i.nombre, tipo: 'venta',
      cantidad: -i.cantidad, saldo, motivo: 'Pedido ' + pedido.folio, por: usuario.nombre
    });
  }

  cerrarModal('modal-nomina');
  $('#recibo-folio').textContent = pedido.folio;
  $('#recibo-lista').innerHTML = pedido.items.map(i =>
    `<li>${miniatura(i.numero)}<div class="nom"><b>${esc(i.nombre)}</b><span>${i.cantidad} × ${money(i.precio)}</span></div>
     <div></div><div class="precio">${money(i.precio * i.cantidad)}</div></li>`).join('');
  $('#recibo-total').textContent = money(pedido.total);
  carrito = [];
  pintarCarrito();
  abrirModal('modal-recibo');
}

$('#recibo-listo').addEventListener('click', () => cerrarModal('modal-recibo'));

/* ── Mis compras ─────────────────────────────────────────── */
$('#btn-mis-compras').addEventListener('click', () => {
  const mios = [...misPedidos].sort((a, b) => b.creado.localeCompare(a.creado));
  const total = mios.reduce((s, p) => s + p.total, 0);
  const pendiente = mios.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);

  $('#historial-resumen').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${mios.length}</b></div>
    <div><span class="eyebrow">Total comprado</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Pendiente</span><b>${money(pendiente)}</b></div>`;

  $('#tabla-historial').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Productos</th><th class="num">Total</th><th>Estado</th></tr></thead>
    <tbody>${mios.length ? mios.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${(p.items || []).map(i => `${i.cantidad}× ${esc(i.nombre)}`).join('<br>')}</td>
        <td class="num">${money(p.total)}</td>
        <td>${marcaEstado(p.estado)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="vacio">Todavía no has comprado nada.</td></tr>'}</tbody>`;

  abrirModal('modal-historial');
});

/* ── Cambio de clave ─────────────────────────────────────── */
let cambioObligatorio = false;

function abrirCambioClave(obligatorio) {
  cambioObligatorio = obligatorio;
  ['#clave-actual', '#clave-nueva', '#clave-nueva2'].forEach(s => $(s).value = '');
  $('#clave-titulo').textContent = obligatorio ? 'Crea tu clave' : 'Cambiar mi clave';
  $('#clave-texto').textContent = obligatorio
    ? 'Estás usando la clave que te asignaron. Elige una propia antes de continuar.'
    : 'Mínimo 4 dígitos.';
  $('#campo-clave-actual').hidden = obligatorio;
  $('#clave-cancelar').hidden = obligatorio;
  $('#modal-cambiar-clave').classList.toggle('fijo', obligatorio);
  abrirModal('modal-cambiar-clave');
}

$('#btn-mi-cuenta').addEventListener('click', () => abrirCambioClave(false));
$('#clave-cancelar').addEventListener('click', () => cerrarModal('modal-cambiar-clave'));

$('#clave-guardar').addEventListener('click', async () => {
  const nueva = $('#clave-nueva').value.trim();
  const nueva2 = $('#clave-nueva2').value.trim();
  if (nueva.length < 4) return aviso('La clave necesita al menos 4 dígitos.', 'error');
  if (nueva !== nueva2) return aviso('Las dos claves no coinciden.', 'error');
  if (!cambioObligatorio && await hashClave($('#clave-actual').value, usuario.sal) !== usuario.clave)
    return aviso('La clave actual no coincide.', 'error');
  if (nueva === usuario.cedula.slice(-4))
    return aviso('Elige una clave distinta a los últimos dígitos de tu cédula.', 'error');

  const sal = uid();
  const cambios = { sal, clave: await hashClave(nueva, sal), debeCambiar: false };
  if (!await conError(actualizar('usuarios/' + usuario.cedula, cambios), 'cambiar la clave')) return;

  Object.assign(usuario, cambios);
  cambioObligatorio = false;
  $('#modal-cambiar-clave').classList.remove('fijo');
  cerrarModal('modal-cambiar-clave');
  aviso('Clave actualizada', 'ok');
});

/* ══════════════ ADMINISTRACIÓN ══════════════ */
function escucharComoAdmin() {
  if (escuchandoAdmin) return;
  escuchandoAdmin = true;
  escuchar('usuarios', v => { datos.usuarios = v; pintarUsuarios(); });
  escuchar('pedidos', v => { datos.pedidos = v; pintarPedidos(); });
  escuchar('movimientos', v => { datos.movimientos = v; pintarInventario(); });
}

$('#pestanas').addEventListener('click', e => {
  const b = e.target.closest('.pestana'); if (!b) return;
  $$('.pestana').forEach(x => x.classList.remove('activa'));
  $$('.panel').forEach(x => x.classList.remove('activa'));
  b.classList.add('activa');
  $('#panel-' + b.dataset.panel).classList.add('activa');
  ({
    productos: pintarProductos, inventario: pintarInventario,
    usuarios: pintarUsuarios, pedidos: pintarPedidos, ajustes: pintarAjustes
  }[b.dataset.panel] || (() => {}))();
});

/* ── Productos ───────────────────────────────────────────── */
let fotoProducto = '';

function comprimirImagen(archivo, maxLado = 480, calidad = 0.7) {
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

async function cargarFotoProducto(e) {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    fotoProducto = await comprimirImagen(archivo);
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

function siguienteNumero() {
  const usados = productosLista().map(p => parseInt(p.numero, 10)).filter(n => !isNaN(n));
  return String((usados.length ? Math.max(...usados) : 0) + 1).padStart(2, '0');
}

$('#form-producto').addEventListener('submit', async e => {
  e.preventDefault();
  const anteriorNumero = $('#prod-id').value;
  let numero = $('#prod-numero').value.trim() || siguienteNumero();
  if (numero.length === 1) numero = '0' + numero;

  if (!anteriorNumero && datos.productos[numero])
    return aviso('Ya hay un producto con el número ' + numero + '.', 'error');

  const anterior = anteriorNumero ? datos.productos[anteriorNumero] : null;
  const producto = {
    numero,
    codigo: $('#prod-codigo').value.trim(),
    nombre: $('#prod-nombre').value.trim(),
    precio: Number($('#prod-precio').value),
    categoria: $('#prod-categoria').value.trim(),
    stock: Number($('#prod-stock').value || 0),
    minimo: Number($('#prod-minimo').value || 0),
    bloquear: $('#prod-bloquear').checked,
    activo: anterior ? anterior.activo !== false : true
  };

  if (!await conError(guardarNodo('productos/' + numero, producto), 'guardar el producto')) return;
  await guardarNodo('fotos/' + numero, fotoProducto || null);
  if (anteriorNumero && anteriorNumero !== numero) {
    await borrarNodo('productos/' + anteriorNumero);
    await borrarNodo('fotos/' + anteriorNumero);
  }

  const delta = producto.stock - Number(anterior?.stock || 0);
  if (delta !== 0) registrarMovimiento({
    numero, producto: producto.nombre,
    tipo: anterior ? 'ajuste' : 'entrada',
    cantidad: delta, saldo: producto.stock,
    motivo: anterior ? 'Ajuste desde la ficha' : 'Existencias iniciales',
    por: usuario.nombre
  });

  limpiarFormProducto();
  aviso('Producto guardado', 'ok');
});

function limpiarFormProducto() {
  $('#form-producto').reset();
  $('#prod-id').value = '';
  fotoProducto = '';
  $('#prod-foto-vista').innerHTML = '<span>Sin foto</span>';
  $('#prod-foto-quitar').hidden = true;
  $('#prod-stock').value = 0;
  $('#prod-minimo').value = 5;
  $('#prod-bloquear').checked = true;
  $('#prod-guardar').textContent = 'Agregar producto';
  $('#prod-cancelar').hidden = true;
}
$('#prod-cancelar').addEventListener('click', limpiarFormProducto);
$('#buscar-producto').addEventListener('input', pintarProductos);

function estadoStock(p) {
  const s = Number(p.stock || 0), m = Number(p.minimo || 0);
  if (s <= 0) return { texto: 'Agotado', clase: 'agotado' };
  if (s <= m) return { texto: 'Por acabarse', clase: 'pendiente' };
  return { texto: 'Disponible', clase: 'ok' };
}
const productosBajos = () =>
  productosLista().filter(p => p.activo !== false && Number(p.stock || 0) <= Number(p.minimo || 0));

function pintarProductos() {
  const q = ($('#buscar-producto').value || '').trim().toLowerCase();
  const lista = productosLista()
    .filter(p => !q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q) || (p.numero || '').includes(q))
    .sort((a, b) => (a.numero || '').localeCompare(b.numero || '', 'es', { numeric: true }));

  $('#tabla-productos').innerHTML = `
    <thead><tr><th>Foto</th><th>N.º</th><th>Código</th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th class="num">Quedan</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td>${miniatura(p.numero)}</td>
        <td class="cod">${esc(p.numero)}</td>
        <td class="cod">${esc(p.codigo || '—')}</td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria || '—')}</td>
        <td class="num">${money(p.precio)}</td>
        <td class="num">${Number(p.stock || 0)}</td>
        <td>${p.activo === false ? '<span class="marca marca-inactivo">Oculto</span>' : `<span class="marca marca-${estadoStock(p).clase}">${estadoStock(p).texto}</span>`}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-editar-p="${esc(p.numero)}">Editar</button>
          <button type="button" class="btn btn-fantasma mini" data-alternar-p="${esc(p.numero)}">${p.activo === false ? 'Mostrar' : 'Ocultar'}</button>
          <button type="button" class="btn btn-fantasma mini" data-borrar-p="${esc(p.numero)}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="9" class="vacio">Aún no hay productos.</td></tr>'}</tbody>`;
}

$('#tabla-productos').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;

  if (b.dataset.editarP) {
    const p = datos.productos[b.dataset.editarP];
    $('#prod-id').value = p.numero;
    $('#prod-numero').value = p.numero;
    $('#prod-codigo').value = p.codigo || '';
    $('#prod-nombre').value = p.nombre;
    $('#prod-precio').value = p.precio;
    $('#prod-categoria').value = p.categoria || '';
    $('#prod-stock').value = Number(p.stock || 0);
    $('#prod-minimo').value = Number(p.minimo || 0);
    $('#prod-bloquear').checked = p.bloquear !== false;
    fotoProducto = fotoDe(p.numero);
    $('#prod-foto-vista').innerHTML = fotoProducto ? `<img src="${fotoProducto}" alt="">` : '<span>Sin foto</span>';
    $('#prod-foto-quitar').hidden = !fotoProducto;
    $('#prod-guardar').textContent = 'Guardar cambios';
    $('#prod-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.alternarP) {
    const p = datos.productos[b.dataset.alternarP];
    await actualizar('productos/' + p.numero, { activo: p.activo === false });
  }
  if (b.dataset.borrarP) {
    if (!confirm('¿Borrar este producto? Los pedidos anteriores no cambian.')) return;
    await borrarNodo('productos/' + b.dataset.borrarP);
    await borrarNodo('fotos/' + b.dataset.borrarP);
    aviso('Producto borrado', 'ok');
  }
});

const columnasCSV = linea => linea.split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, ''));

$('#importar-productos').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const filas = (await archivo.text()).split(/\r?\n/).filter(l => l.trim());
  const cab = columnasCSV(filas[0]).map(c => c.toLowerCase());
  const tiene = cab.some(c => ['numero','número','codigo','código','nombre'].includes(c));
  const col = n => {
    const i = cab.findIndex(c => n.includes(c));
    return tiene ? i : { numero: 0, codigo: 1, nombre: 2, precio: 3, categoria: 4, existencias: 5, minimo: 6 }[n[0]];
  };
  const idx = {
    numero: col(['numero','número']), codigo: col(['codigo','código']), nombre: col(['nombre']),
    precio: col(['precio']), categoria: col(['categoria','categoría']),
    existencias: col(['existencias','stock']), minimo: col(['minimo','mínimo'])
  };

  let nuevos = 0;
  const cambios = {};
  for (let i = tiene ? 1 : 0; i < filas.length; i++) {
    const c = columnasCSV(filas[i]);
    const dato = k => (idx[k] >= 0 ? c[idx[k]] : '') || '';
    const nombre = dato('nombre'), precio = dato('precio');
    if (!nombre || isNaN(Number(precio))) continue;
    let numero = dato('numero') || siguienteNumero();
    if (numero.length === 1) numero = '0' + numero;
    const previo = datos.productos[numero] || {};
    cambios[numero] = {
      numero, codigo: dato('codigo') || previo.codigo || '', nombre, precio: Number(precio),
      categoria: dato('categoria') || previo.categoria || '',
      stock: dato('existencias') !== '' ? Number(dato('existencias')) : Number(previo.stock || 0),
      minimo: dato('minimo') !== '' ? Number(dato('minimo')) : Number(previo.minimo ?? 5),
      bloquear: previo.bloquear !== false, activo: previo.activo !== false
    };
    if (!datos.productos[numero]) nuevos++;
  }
  if (await conError(actualizar('productos', cambios), 'importar los productos'))
    aviso(`Importación lista. ${nuevos} productos nuevos.`, 'ok');
  e.target.value = '';
});

$('#exportar-productos').addEventListener('click', () => {
  const filas = [['numero','codigo','nombre','precio','categoria','existencias','minimo']].concat(
    productosLista().map(p => [p.numero, p.codigo || '', p.nombre, p.precio, p.categoria || '', Number(p.stock || 0), Number(p.minimo || 0)]));
  descargar('productos.csv', aCSV(filas), 'text/csv');
});

/* ── Inventario ──────────────────────────────────────────── */
function registrarMovimiento(mov) {
  const id = uid();
  guardarNodo('movimientos/' + id, { id, fecha: new Date().toISOString(), ...mov }).catch(() => {});
}

$('#form-movimiento').addEventListener('submit', async e => {
  e.preventDefault();
  const p = datos.productos[$('#inv-producto').value];
  if (!p) return aviso('Elige un producto.', 'error');
  const cantidad = Number($('#inv-cantidad').value);
  if (isNaN(cantidad) || cantidad < 0) return aviso('Escribe una cantidad válida.', 'error');

  const tipo = $('#inv-tipo').value;
  const antes = Number(p.stock || 0);
  const resultado = await runTransaction(ref(db, `productos/${p.numero}/stock`), actual => {
    const s = Number(actual || 0);
    if (tipo === 'entrada') return s + cantidad;
    if (tipo === 'baja')    return s - cantidad;
    return cantidad;
  });
  if (!resultado.committed) return aviso('No se pudo registrar el movimiento.', 'error');

  const saldo = resultado.snapshot.val();
  registrarMovimiento({
    numero: p.numero, producto: p.nombre, tipo,
    cantidad: saldo - antes, saldo,
    motivo: $('#inv-motivo').value.trim() ||
      { entrada: 'Entrada de mercancía', baja: 'Baja', ajuste: 'Conteo físico' }[tipo],
    por: usuario.nombre
  });

  $('#inv-cantidad').value = ''; $('#inv-motivo').value = '';
  aviso(`${p.nombre}: quedan ${saldo}`, 'ok');
});

$('#inv-solo-bajos').addEventListener('change', pintarInventario);

function filasInventario() {
  const soloBajos = $('#inv-solo-bajos').checked;
  return productosLista()
    .filter(p => !soloBajos || Number(p.stock || 0) <= Number(p.minimo || 0))
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

function pintarInventario() {
  const sel = $('#inv-producto');
  const previo = sel.value;
  sel.innerHTML = productosLista()
    .sort((a, b) => (a.numero || '').localeCompare(b.numero || '', 'es', { numeric: true }))
    .map(p => `<option value="${esc(p.numero)}">${esc(p.numero)} · ${esc(p.nombre)} (${Number(p.stock || 0)})</option>`).join('');
  if (previo && datos.productos[previo]) sel.value = previo;

  const activos = productosLista().filter(p => p.activo !== false);
  const unidades = activos.reduce((s, p) => s + Number(p.stock || 0), 0);
  const valor = activos.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precio || 0), 0);
  const agotados = activos.filter(p => Number(p.stock || 0) <= 0).length;

  $('#resumen-inventario').innerHTML = `
    <div><span class="eyebrow">Productos</span><b>${activos.length}</b></div>
    <div><span class="eyebrow">Unidades</span><b>${unidades}</b></div>
    <div><span class="eyebrow">Valor</span><b>${money(valor)}</b></div>
    <div><span class="eyebrow">Por acabarse</span><b>${productosBajos().length - agotados}</b></div>
    <div><span class="eyebrow">Agotados</span><b>${agotados}</b></div>`;

  const lista = filasInventario();
  $('#tabla-inventario').innerHTML = `
    <thead><tr><th>N.º</th><th>Producto</th><th class="num">Quedan</th><th class="num">Avisar en</th><th class="num">Valor</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => {
      const e = estadoStock(p);
      return `<tr>
        <td class="cod">${esc(p.numero)}</td>
        <td>${esc(p.nombre)}</td>
        <td class="num">${Number(p.stock || 0)}</td>
        <td class="num">${Number(p.minimo || 0)}</td>
        <td class="num">${money(Number(p.stock || 0) * Number(p.precio || 0))}</td>
        <td><span class="marca marca-${e.clase}">${e.texto}</span></td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-sumar="${esc(p.numero)}">+1</button>
          <button type="button" class="btn btn-fantasma mini" data-restar="${esc(p.numero)}">−1</button>
        </div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="vacio">Nada por aquí con ese filtro.</td></tr>'}</tbody>`;

  const movs = listar(datos.movimientos).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 60);
  $('#tabla-movimientos').innerHTML = `
    <thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th class="num">Cambio</th><th class="num">Saldo</th><th>Motivo</th><th>Quién</th></tr></thead>
    <tbody>${movs.length ? movs.map(m => `
      <tr>
        <td>${fecha(m.fecha)}</td>
        <td>${esc(m.numero)} · ${esc(m.producto)}</td>
        <td>${({ entrada:'Entrada', venta:'Venta', baja:'Baja', ajuste:'Ajuste' })[m.tipo] || esc(m.tipo)}</td>
        <td class="num">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td class="num">${m.saldo}</td>
        <td>${esc(m.motivo || '—')}</td>
        <td>${esc(m.por || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="vacio">Todavía no hay movimientos.</td></tr>'}</tbody>`;
}

$('#tabla-inventario').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const numero = b.dataset.sumar || b.dataset.restar;
  if (!numero) return;
  const delta = b.dataset.sumar ? 1 : -1;
  const r = await runTransaction(ref(db, `productos/${numero}/stock`), s => Number(s || 0) + delta);
  if (r.committed) registrarMovimiento({
    numero, producto: datos.productos[numero]?.nombre || '',
    tipo: delta > 0 ? 'entrada' : 'baja', cantidad: delta,
    saldo: r.snapshot.val(), motivo: 'Corrección rápida', por: usuario.nombre
  });
});

/* ── Usuarios ────────────────────────────────────────────── */
$('#form-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const cedulaAnterior = $('#usr-id').value;
  const cedula = $('#usr-cedula').value.trim();
  const clave = $('#usr-clave').value.trim();
  if (!cedulaAnterior && datos.usuarios[cedula])
    return aviso('Ya hay alguien con esa cédula.', 'error');
  if (!cedulaAnterior && clave.length < 4)
    return aviso('La clave necesita al menos 4 dígitos.', 'error');

  const previo = cedulaAnterior ? datos.usuarios[cedulaAnterior] : null;
  const ficha = {
    id: previo?.id || uid(),
    nombre: $('#usr-nombre').value.trim(),
    cedula,
    correo: $('#usr-correo').value.trim(),
    rol: $('#usr-rol').value,
    activo: previo ? previo.activo !== false : true,
    debeCambiar: $('#usr-cambiar').checked,
    creado: previo?.creado || new Date().toISOString(),
    sal: previo?.sal || uid(),
    clave: previo?.clave || ''
  };
  if (clave) { ficha.sal = uid(); ficha.clave = await hashClave(clave, ficha.sal); }

  if (!await conError(guardarNodo('usuarios/' + cedula, ficha), 'guardar el usuario')) return;
  if (cedulaAnterior && cedulaAnterior !== cedula) await borrarNodo('usuarios/' + cedulaAnterior);

  limpiarFormUsuario();
  aviso('Usuario guardado', 'ok');
});

function limpiarFormUsuario() {
  $('#form-usuario').reset();
  $('#usr-id').value = '';
  $('#usr-clave').value = datos.config.claveGenerica || '';
  $('#usr-cambiar').checked = true;
  $('#usr-guardar').textContent = 'Crear usuario';
  $('#usr-clave').placeholder = '4 dígitos';
  $('#usr-cancelar').hidden = true;
}
$('#usr-cancelar').addEventListener('click', limpiarFormUsuario);
$('#buscar-usuario').addEventListener('input', pintarUsuarios);

function pintarUsuarios() {
  const q = ($('#buscar-usuario').value || '').trim().toLowerCase();
  const pedidos = listar(datos.pedidos);
  const lista = listar(datos.usuarios)
    .filter(u => !q || u.nombre.toLowerCase().includes(q) || u.cedula.includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  $('#tabla-usuarios').innerHTML = `
    <thead><tr><th>Cédula</th><th>Nombre</th><th>Rol</th><th class="num">Pedidos</th><th class="num">Pendiente</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(u => {
      const mios = pedidos.filter(p => p.cedula === u.cedula);
      const deuda = mios.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
      return `<tr>
        <td class="cod">${esc(u.cedula)}</td>
        <td>${esc(u.nombre)}</td>
        <td>${u.rol === 'admin' ? 'Administrador' : 'Empleado'}</td>
        <td class="num">${mios.length}</td>
        <td class="num">${money(deuda)}</td>
        <td>${u.activo === false ? '<span class="marca marca-inactivo">Inactivo</span>' : '<span class="marca marca-ok">Activo</span>'}${u.debeCambiar ? '<br><span class="marca marca-pendiente">Clave inicial</span>' : ''}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-editar-u="${esc(u.cedula)}">Editar</button>
          <button type="button" class="btn btn-fantasma mini" data-reiniciar-u="${esc(u.cedula)}">Reiniciar clave</button>
          <button type="button" class="btn btn-fantasma mini" data-alternar-u="${esc(u.cedula)}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>`;
}

$('#tabla-usuarios').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;

  if (b.dataset.editarU) {
    const u = datos.usuarios[b.dataset.editarU];
    $('#usr-id').value = u.cedula; $('#usr-nombre').value = u.nombre;
    $('#usr-cedula').value = u.cedula; $('#usr-rol').value = u.rol;
    $('#usr-correo').value = u.correo || '';
    $('#usr-cambiar').checked = !!u.debeCambiar;
    $('#usr-clave').value = ''; $('#usr-clave').placeholder = 'Déjala vacía para no cambiarla';
    $('#usr-guardar').textContent = 'Guardar cambios';
    $('#usr-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.reiniciarU) {
    const u = datos.usuarios[b.dataset.reiniciarU];
    const nueva = u.cedula.slice(-4);
    if (!confirm(`La clave de ${u.nombre} quedará en ${nueva} y se le pedirá cambiarla. ¿Continuar?`)) return;
    const sal = uid();
    await actualizar('usuarios/' + u.cedula, { sal, clave: await hashClave(nueva, sal), debeCambiar: true });
    aviso(`Clave de ${u.nombre} reiniciada en ${nueva}`, 'ok');
  }
  if (b.dataset.alternarU) {
    const u = datos.usuarios[b.dataset.alternarU];
    if (u.cedula === usuario.cedula) return aviso('No puedes desactivar tu propio usuario.', 'error');
    await actualizar('usuarios/' + u.cedula, { activo: u.activo === false });
  }
});

$('#importar-usuarios').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const filas = (await archivo.text()).split(/\r?\n/).filter(l => l.trim());
  const cab = columnasCSV(filas[0]).map(c => c.toLowerCase());
  const tiene = cab.some(c => ['cedula','cédula','identificacion','nombre'].includes(c));
  const iC = tiene ? cab.findIndex(c => ['cedula','cédula','identificacion','identificación'].includes(c)) : 1;
  const iN = tiene ? cab.findIndex(c => c === 'nombre') : 0;
  const iM = tiene ? cab.findIndex(c => c === 'correo' || c === 'email') : -1;

  const cambios = {};
  let nuevos = 0;
  for (let i = tiene ? 1 : 0; i < filas.length; i++) {
    const c = columnasCSV(filas[i]);
    const cedula = (c[iC] || '').trim(), nombre = (c[iN] || '').trim();
    if (!cedula || !nombre) continue;
    const previo = datos.usuarios[cedula];
    if (previo) { cambios[cedula] = { ...previo, nombre, correo: (iM >= 0 ? c[iM] : previo.correo) || '' }; continue; }
    const sal = uid();
    cambios[cedula] = {
      id: uid(), nombre, cedula, correo: (iM >= 0 ? c[iM] : '') || '', rol: 'empleado',
      sal, clave: await hashClave(cedula.slice(-4), sal),
      activo: true, debeCambiar: true, creado: new Date().toISOString()
    };
    nuevos++;
  }
  if (await conError(actualizar('usuarios', cambios), 'importar el personal'))
    aviso(`Listo. ${nuevos} personas nuevas, con los últimos 4 dígitos de su cédula como clave.`, 'ok');
  e.target.value = '';
});

$('#exportar-usuarios').addEventListener('click', () => {
  const filas = [['cedula','nombre','correo','rol','activo']].concat(
    listar(datos.usuarios).map(u => [u.cedula, u.nombre, u.correo || '', u.rol, u.activo === false ? 'no' : 'si']));
  descargar('usuarios.csv', aCSV(filas), 'text/csv');
});

/* ── Pedidos ─────────────────────────────────────────────── */
['#f-desde', '#f-hasta', '#f-estado', '#f-persona']
  .forEach(s => $(s).addEventListener('input', pintarPedidos));

function pedidosFiltrados() {
  const desde = $('#f-desde').value, hasta = $('#f-hasta').value;
  const estado = $('#f-estado').value;
  const q = ($('#f-persona').value || '').trim().toLowerCase();
  return listar(datos.pedidos).filter(p => {
    const d = (p.creado || '').slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    if (estado && p.estado !== estado) return false;
    if (q && !(p.nombre.toLowerCase().includes(q) || p.cedula.includes(q))) return false;
    return true;
  }).sort((a, b) => b.creado.localeCompare(a.creado));
}

function rotuloPeriodo() {
  const d = $('#f-desde').value, h = $('#f-hasta').value;
  if (d && h) return `Del ${d} al ${h}`;
  if (d) return `Desde el ${d}`;
  if (h) return `Hasta el ${h}`;
  return 'Todo el histórico';
}

function pintarPedidos() {
  const lista = pedidosFiltrados();
  const total = lista.reduce((s, p) => s + p.total, 0);
  const pendiente = lista.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);

  $('#resumen-pedidos').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${lista.length}</b></div>
    <div><span class="eyebrow">Personas</span><b>${new Set(lista.map(p => p.cedula)).size}</b></div>
    <div><span class="eyebrow">Total</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Pendiente</span><b>${money(pendiente)}</b></div>`;

  $('#rep-destino').textContent = datos.config.correo
    ? `Se enviará a ${datos.config.correo} por n8n. Período: ${rotuloPeriodo().toLowerCase()}.`
    : 'Falta el correo que recibe los reportes.';

  const resumen = datosResumen(lista).filter(r => r.pedidos > 0);
  $('#tabla-nomina').innerHTML = `
    <thead><tr><th>Cédula</th><th>Nombre</th><th class="num">Pedidos</th><th class="num">Total</th><th class="num">Pendiente</th><th></th></tr></thead>
    <tbody>${resumen.length ? resumen.map(r => `
      <tr><td class="cod">${esc(r.cedula)}</td><td>${esc(r.nombre)}</td>
      <td class="num">${r.pedidos}</td><td class="num">${money(r.total)}</td><td class="num">${money(r.pendiente)}</td>
      <td><div class="tabla-acciones">${r.pendiente > 0
        ? `<button type="button" class="btn btn-fantasma mini" data-conciliar="${esc(r.cedula)}">Marcar descontado</button>` : ''}</div></td></tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Nadie ha pedido en este período.</td></tr>'}</tbody>`;

  $('#tabla-pedidos').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Persona</th><th>Productos</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${esc(p.nombre)}<br><span class="cod">${esc(p.cedula)}</span></td>
        <td>${(p.items || []).map(i => `${i.cantidad}× ${esc(i.nombre)}`).join('<br>')}</td>
        <td class="num">${money(p.total)}</td>
        <td>${marcaEstado(p.estado)}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-estado="${p.id}">${p.estado === 'pendiente' ? 'Marcar descontado' : 'Reabrir'}</button>
          <button type="button" class="btn btn-fantasma mini" data-borrar-o="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="7" class="vacio">No hay pedidos con estos filtros.</td></tr>'}</tbody>`;
}

$('#tabla-pedidos').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.estado) {
    const p = datos.pedidos[b.dataset.estado];
    await actualizar('pedidos/' + p.id, { estado: p.estado === 'pendiente' ? 'conciliado' : 'pendiente' });
  }
  if (b.dataset.borrarO) {
    if (!confirm('¿Borrar este pedido? No se puede deshacer.')) return;
    await borrarNodo('pedidos/' + b.dataset.borrarO);
    aviso('Pedido borrado', 'ok');
  }
});

$('#tabla-nomina').addEventListener('click', async e => {
  const b = e.target.closest('[data-conciliar]'); if (!b) return;
  if (!confirm('¿Marcar como descontados todos los pedidos pendientes de esta persona?')) return;
  const cambios = {};
  listar(datos.pedidos)
    .filter(p => p.cedula === b.dataset.conciliar && p.estado === 'pendiente')
    .forEach(p => { cambios[p.id + '/estado'] = 'conciliado'; });
  if (await conError(actualizar('pedidos', cambios), 'actualizar los pedidos'))
    aviso('Pedidos marcados como descontados', 'ok');
});

/* ── Datos de los reportes ───────────────────────────────── */
function datosResumen(lista) {
  const mapa = new Map();
  listar(datos.usuarios).filter(u => u.activo !== false).forEach(u => {
    mapa.set(u.cedula, { cedula: u.cedula, nombre: u.nombre, pedidos: 0, total: 0, pendiente: 0 });
  });
  lista.forEach(p => {
    if (!mapa.has(p.cedula)) mapa.set(p.cedula, { cedula: p.cedula, nombre: p.nombre, pedidos: 0, total: 0, pendiente: 0 });
    const r = mapa.get(p.cedula);
    r.pedidos++; r.total += p.total;
    if (p.estado === 'pendiente') r.pendiente += p.total;
  });
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

const CAB_DETALLE = ['Cédula','Nombre','Pedido','Fecha','N.º','Producto','Cantidad','Precio','Subtotal','Estado'];
const CAB_RESUMEN = ['Cédula','Nombre','Pedidos','Total','Pendiente de descuento'];

function armarReporte(tipo) {
  const lista = pedidosFiltrados();
  const detalle = tipo === 'detallado';
  const filas = detalle
    ? [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.creado.localeCompare(b.creado))
        .flatMap(p => (p.items || []).map(i => [
          p.cedula, p.nombre, p.folio, fechaCorta(p.creado),
          i.numero || '', i.nombre, i.cantidad, i.precio, i.precio * i.cantidad,
          (ESTADOS[p.estado] || {}).texto || p.estado]))
    : datosResumen(lista).map(r => [r.cedula, r.nombre, r.pedidos, r.total, r.pendiente]);

  return {
    tipo,
    titulo: detalle ? 'Detalle de consumo por persona' : 'Resumen de consumo por persona',
    periodo: rotuloPeriodo(),
    cabeceras: detalle ? CAB_DETALLE : CAB_RESUMEN,
    filas,
    columnasMoneda: detalle ? [7, 8] : [3, 4],
    total: lista.reduce((s, p) => s + p.total, 0),
    pendiente: lista.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0),
    pedidos: lista.length
  };
}

function reporteInventario() {
  const lista = filasInventario();
  return {
    tipo: 'inventario', titulo: 'Inventario de la tienda',
    periodo: `Corte del ${new Date().toLocaleString('es-CO')}`,
    cabeceras: ['N.º','Código','Producto','Categoría','Precio','Quedan','Avisar en','Valor','Estado'],
    filas: lista.map(p => [p.numero, p.codigo || '', p.nombre, p.categoria || '',
      Number(p.precio || 0), Number(p.stock || 0), Number(p.minimo || 0),
      Number(p.stock || 0) * Number(p.precio || 0), estadoStock(p).texto]),
    columnasMoneda: [4, 7],
    total: lista.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precio || 0), 0),
    pendiente: 0, pedidos: lista.length
  };
}

/* ── CSV, PDF y correo ───────────────────────────────────── */
const aCSV = filas => '\uFEFF' + filas.map(f =>
  f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvDeReporte = rep => aCSV([
  [rep.titulo], [datos.config.empresa], [rep.periodo],
  [`Generado: ${new Date().toLocaleString('es-CO')}`], [],
  rep.cabeceras, ...rep.filas, [],
  ['', 'Total', '', rep.total], ['', 'Pendiente', '', rep.pendiente]
]);

function aBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function cargarPDF() {
  if (!window.jspdf) await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!window.jspdf?.jsPDF) throw new Error('No se pudo cargar el generador de PDF.');
  try {
    if (!window.jspdf.__tabla) {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
      window.jspdf.__tabla = true;
    }
  } catch {}
  return window.jspdf.jsPDF;
}

async function pdfDeReporte(rep) {
  const jsPDF = await cargarPDF();
  const doc = new jsPDF({ orientation: rep.cabeceras.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(datos.config.empresa || 'Tienda interna', 40, 45);
  doc.setFontSize(12); doc.text(rep.titulo, 40, 64);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(rep.periodo, 40, 80);
  doc.text(`Generado el ${new Date().toLocaleString('es-CO')}`, 40, 93);
  doc.text(`Pedidos: ${rep.pedidos}   Total: ${money(rep.total)}   Pendiente: ${money(rep.pendiente)}`, 40, 106);
  doc.setTextColor(0);

  const cuerpo = rep.filas.map(f => f.map((c, i) => rep.columnasMoneda.includes(i) ? money(c) : String(c)));

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head: [rep.cabeceras], body: cuerpo, startY: 122,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [16, 20, 24], textColor: 242 },
      alternateRowStyles: { fillColor: [244, 245, 241] },
      columnStyles: Object.fromEntries(rep.columnasMoneda.map(i => [i, { halign: 'right' }])),
      margin: { left: 40, right: 40 }
    });
  } else {
    let y = 130;
    doc.setFontSize(8);
    cuerpo.forEach(f => {
      if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 50; }
      doc.text(f.join('  |  ').slice(0, 180), 40, y);
      y += 12;
    });
  }
  return doc;
}

async function llamarWebhook(cuerpo, segundos = 25) {
  if (!datos.config.webhook) throw new Error('falta la URL del webhook de n8n en Ajustes.');
  const cabeceras = { 'Content-Type': 'application/json' };
  if (datos.config.token) cabeceras['X-Tienda-Token'] = datos.config.token;

  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), segundos * 1000);
  let r;
  try {
    r = await fetch(datos.config.webhook, {
      method: 'POST', headers: cabeceras, signal: corte.signal,
      body: JSON.stringify({ empresa: datos.config.empresa, generado: new Date().toISOString(), ...cuerpo })
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'n8n tardó demasiado.'
      : 'no hubo respuesta de n8n. Revisa la URL, que el flujo esté activo y el CORS.');
  } finally { clearTimeout(reloj); }

  if (r.status === 401 || r.status === 403) throw new Error('n8n rechazó el token.');
  if (r.status === 404) throw new Error('n8n no encontró ese webhook. ¿El flujo está activo?');
  if (!r.ok) throw new Error('n8n respondió ' + r.status);
  return r;
}

const nombreArchivo = (rep, ext) =>
  `${rep.tipo}_tienda_${hoy()}.${ext}`;

async function enviarReporte(rep, extra = {}) {
  if (!datos.config.correo) return aviso('Falta el correo que recibe los reportes.', 'error');
  aviso('Preparando el reporte…');
  const adjuntos = [{ nombre: nombreArchivo(rep, 'csv'), tipo: 'text/csv', contenidoBase64: aBase64(csvDeReporte(rep)) }];
  try {
    const doc = await pdfDeReporte(rep);
    adjuntos.push({ nombre: nombreArchivo(rep, 'pdf'), tipo: 'application/pdf', contenidoBase64: doc.output('datauristring').split(',')[1] });
  } catch { aviso('El PDF no se pudo generar; va solo el Excel.', 'error'); }

  try {
    await llamarWebhook({
      tipo: rep.tipo === 'inventario' ? 'inventario' : 'reporte',
      para: datos.config.correo,
      asunto: `${rep.titulo} · ${datos.config.empresa} · ${hoy()}`,
      resumen: `${rep.titulo}\n${rep.periodo}\nPedidos: ${rep.pedidos}\nTotal: ${money(rep.total)}\nPendiente: ${money(rep.pendiente)}`,
      periodo: rep.periodo, adjuntos, ...extra
    });
    aviso('Reporte enviado a ' + datos.config.correo, 'ok');
  } catch (err) {
    aviso('No se pudo enviar: ' + err.message, 'error');
  }
}

$('#rep-csv').addEventListener('click', () => {
  const rep = armarReporte($('#rep-tipo').value);
  if (!rep.filas.length) return aviso('No hay datos para ese reporte.', 'error');
  descargar(nombreArchivo(rep, 'csv'), csvDeReporte(rep), 'text/csv');
});
$('#rep-pdf').addEventListener('click', async () => {
  const rep = armarReporte($('#rep-tipo').value);
  if (!rep.filas.length) return aviso('No hay datos para ese reporte.', 'error');
  aviso('Generando el PDF…');
  try { (await pdfDeReporte(rep)).save(nombreArchivo(rep, 'pdf')); }
  catch (err) { aviso('No se pudo generar el PDF: ' + err.message, 'error'); }
});
$('#rep-correo').addEventListener('click', () => enviarReporte(armarReporte($('#rep-tipo').value)));

$('#inv-csv').addEventListener('click', () => {
  const rep = reporteInventario();
  descargar(nombreArchivo(rep, 'csv'), csvDeReporte(rep), 'text/csv');
});
$('#inv-pdf').addEventListener('click', async () => {
  aviso('Generando el PDF…');
  try { (await pdfDeReporte(reporteInventario())).save(`inventario_${hoy()}.pdf`); }
  catch (err) { aviso('No se pudo generar el PDF: ' + err.message, 'error'); }
});
$('#inv-correo').addEventListener('click', () => enviarReporte(reporteInventario(), {
  porReponer: productosBajos().map(p => ({ numero: p.numero, nombre: p.nombre, quedan: Number(p.stock || 0) }))
}));

$('#mov-csv').addEventListener('click', () => {
  const filas = [['fecha','numero','producto','movimiento','cambio','saldo','motivo','quien']].concat(
    listar(datos.movimientos).sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map(m => [fecha(m.fecha), m.numero, m.producto, m.tipo, m.cantidad, m.saldo, m.motivo || '', m.por || '']));
  descargar(`movimientos_${hoy()}.csv`, aCSV(filas), 'text/csv');
});

/* ── Ajustes ─────────────────────────────────────────────── */
function pintarAjustes() {
  $('#cfg-empresa').value = datos.config.empresa || '';
  $('#cfg-correo').value = datos.config.correo || '';
  $('#cfg-moneda').value = datos.config.moneda || 'COP';
  $('#cfg-generica').value = datos.config.claveGenerica || '';
  $('#cfg-webhook').value = datos.config.webhook || '';
  $('#cfg-token').value = datos.config.token || '';
  $('#version-app').textContent =
    `Versión 4 · ${listar(datos.usuarios).length} usuarios · ${productosLista().length} productos · ${listar(datos.pedidos).length} pedidos.`;
}

$('#form-ajustes').addEventListener('submit', async e => {
  e.preventDefault();
  const nueva = {
    empresa: $('#cfg-empresa').value.trim() || 'Tienda interna',
    correo: $('#cfg-correo').value.trim(),
    moneda: $('#cfg-moneda').value,
    claveGenerica: $('#cfg-generica').value.trim() || '1234',
    webhook: $('#cfg-webhook').value.trim(),
    token: $('#cfg-token').value.trim()
  };
  if (await conError(actualizar('config', nueva), 'guardar los ajustes')) aviso('Ajustes guardados', 'ok');
});

$('#cfg-probar').addEventListener('click', async () => {
  const destino = $('#cfg-correo').value.trim();
  if (!destino) return aviso('Escribe primero el correo.', 'error');
  aviso('Enviando prueba…');
  try {
    await llamarWebhook({ tipo: 'prueba', para: destino, nombre: usuario?.nombre || 'Administrador' });
    aviso('Prueba enviada a ' + destino, 'ok');
  } catch (err) { aviso('No se pudo enviar: ' + err.message, 'error'); }
});

$('#respaldo-descargar').addEventListener('click', () => {
  descargar(`respaldo_tienda_${hoy()}.json`, JSON.stringify({
    version: 4, generado: new Date().toISOString(),
    usuarios: datos.usuarios, productos: datos.productos,
    pedidos: datos.pedidos, movimientos: datos.movimientos, config: datos.config
  }), 'application/json');
});

$('#borrar-pedidos').addEventListener('click', async () => {
  if (!confirm('¿Borrar los pedidos ya descontados?')) return;
  const cambios = {};
  listar(datos.pedidos).filter(p => p.estado === 'conciliado').forEach(p => { cambios[p.id] = null; });
  if (!Object.keys(cambios).length) return aviso('No hay pedidos descontados.', 'ok');
  if (await conError(actualizar('pedidos', cambios), 'borrar los pedidos')) aviso('Pedidos borrados', 'ok');
});

/* ── Instalación como app ────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registro = await navigator.serviceWorker.register('sw.js');
      registro.addEventListener('updatefound', () => {
        const entrante = registro.installing;
        entrante?.addEventListener('statechange', () => {
          if (entrante.state === 'installed' && navigator.serviceWorker.controller)
            aviso('Hay una versión nueva. Cierra la app y vuelve a abrirla.', 'ok');
        });
      });
      setInterval(() => registro.update(), 30 * 60 * 1000);
    } catch {}
  });
}

/* ── Arranque ────────────────────────────────────────────── */
(async function arrancar() {
  try {
    await signInAnonymously(auth);
  } catch (err) {
    $('#cargando').innerHTML = `<p class="nota">No se pudo conectar con Firebase: ${esc(err.message)}<br>
      Revisa que el acceso anónimo esté activado en Authentication.</p>`;
    return;
  }

  let listo = false;
  escuchar('config', v => {
    datos.config = { ...CONFIG_BASE, ...v };
    $('#marca-empresa').textContent = datos.config.empresa;
    document.title = datos.config.empresa;
    if (!listo) {
      listo = true;
      $('#cargando').hidden = true;
      const s = JSON.parse(localStorage.getItem('ti_sesion') || 'null');
      if (s && Date.now() - s.ts < 12 * 60 * 60 * 1000) {
        get(ref(db, 'usuarios/' + s.cedula)).then(snap => {
          const f = snap.val();
          if (f && f.activo !== false) abrirSesion(f); else mostrar('pantalla-login');
        }).catch(() => mostrar('pantalla-login'));
      } else {
        mostrar('pantalla-login');
      }
    }
  });

  escuchar('productos', v => { datos.productos = v; pintarRejilla(); pintarProductos(); pintarInventario(); });
  escuchar('fotos', v => { datos.fotos = v; pintarRejilla(); });
})();
