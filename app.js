/* ═══════════════════════════════════════════════════════════
   Tienda interna · versión 3
   Único método de pago: descuento de nómina.
   Reportes en Excel y PDF, detallados o resumidos.
   El correo lo envía un flujo de n8n, no el aplicativo.
   Los datos viven en el navegador de la tableta.
   ═══════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const K = {
  usuarios : 'ti_usuarios',
  productos: 'ti_productos',
  pedidos  : 'ti_pedidos',
  movimientos: 'ti_movimientos',
  config   : 'ti_config',
  sesion   : 'ti_sesion'
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
};

function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
  catch {
    aviso('No queda espacio en la tableta. Borra pedidos descontados desde Respaldo.', 'error');
    return false;
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoy = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

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

let config = {};
const money = n => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: config.moneda || 'COP', maximumFractionDigits: 0
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
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = (((h << 5) + h) ^ txt.charCodeAt(i)) >>> 0;
  return 'simple_' + h.toString(16);
}

function cargarScript(src) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error('script'));
    document.head.append(s);
  });
}

/* ── Datos ───────────────────────────────────────────────── */
let productos = [];
const leerUsuarios = () => LS.get(K.usuarios, []);
const leerPedidos  = () => LS.get(K.pedidos, []);
const leerMovimientos = () => LS.get(K.movimientos, []);
const refrescarProductos = () => { productos = LS.get(K.productos, []); };

const CONFIG_BASE = {
  empresa: 'Tienda interna',
  correo: '',
  moneda: 'COP',
  claveGenerica: '1234',
  dominioCorreo: 'lutec.com.co',
  webhook: '',
  token: '',
  correoRecuperacion: true
};

function siguienteNumero(lista) {
  const usados = lista.map(p => parseInt(p.numero, 10)).filter(n => !isNaN(n));
  return String((usados.length ? Math.max(...usados) : 0) + 1).padStart(2, '0');
}

let codigoInicial = null;

async function inicializarDatos() {
  config = { ...CONFIG_BASE, ...LS.get(K.config, {}) };
  // Restos de versiones anteriores
  ['qr', 'codigoCorto', 'instrucciones', 'usarFuncion'].forEach(k => delete config[k]);
  guardar(K.config, config);
  localStorage.removeItem('ti_soportes');

  if (!localStorage.getItem(K.productos)) {
    guardar(K.productos, [
      { id: uid(), numero: '01', codigo: '7702001010101', nombre: 'Café en vaso',      precio: 2500, categoria: 'Bebidas', foto: '', activo: true, stock: 24, minimo: 6, bloquear: true },
      { id: uid(), numero: '02', codigo: '7702001010102', nombre: 'Agua 600 ml',       precio: 3000, categoria: 'Bebidas', foto: '', activo: true, stock: 24, minimo: 6, bloquear: true },
      { id: uid(), numero: '03', codigo: '7702001010103', nombre: 'Galletas surtidas', precio: 4200, categoria: 'Snacks',  foto: '', activo: true, stock: 12, minimo: 4, bloquear: true }
    ]);
  }
  refrescarProductos();

  let cambio = false;
  productos.forEach(p => {
    if (!p.numero) { p.numero = siguienteNumero(productos); cambio = true; }
    if (p.foto === undefined) { p.foto = ''; cambio = true; }
    if (p.stock === undefined) { p.stock = 0; p.minimo = 5; p.bloquear = false; cambio = true; }
  });
  if (cambio) guardar(K.productos, productos);

  // Pedidos de versiones con pago inmediato: todo pasa a descuento de nómina
  const pedidos = leerPedidos();
  let cambioP = false;
  pedidos.forEach(p => {
    if (p.metodo && p.metodo !== 'nomina') {
      p.metodo = 'nomina';
      (p.historial = p.historial || []).push({
        fecha: new Date().toISOString(), texto: 'Pago inmediato retirado: queda como descuento de nómina', por: 'Sistema'
      });
      cambioP = true;
    }
    if (p.estado === 'aprobado')   { p.estado = 'pendiente';  cambioP = true; }
    if (p.estado === 'verificado') { p.estado = 'conciliado'; cambioP = true; }
    if (p.referencia !== undefined) { delete p.referencia; cambioP = true; }
  });
  if (cambioP) guardar(K.pedidos, pedidos);

  if (!localStorage.getItem(K.usuarios)) {
    const sal = uid();
    const admin = {
      id: uid(), nombre: 'Administrador', cedula: '0000', correo: '', rol: 'admin',
      sal, clave: await hashClave('1234', sal), activo: true, debeCambiar: true,
      creado: new Date().toISOString()
    };
    codigoInicial = await asignarCodigo(admin);
    guardar(K.usuarios, [admin]);
    $('#nota-admin').textContent = 'Primer ingreso: identificación 0000 y contraseña 1234.';
  }
}

/* ── Envío de correo por n8n ─────────────────────────────── */
function aBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  const paso = 0x8000;
  for (let i = 0; i < bytes.length; i += paso) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
  }
  return btoa(bin);
}

async function llamarWebhook(datos, segundos = 25) {
  if (!config.webhook) throw new Error('falta la URL del webhook de n8n en Ajustes.');

  const cabeceras = { 'Content-Type': 'application/json' };
  if (config.token) cabeceras['X-Tienda-Token'] = config.token;

  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), segundos * 1000);

  let r;
  try {
    r = await fetch(config.webhook, {
      method: 'POST', headers: cabeceras, signal: corte.signal,
      body: JSON.stringify({ empresa: config.empresa, generado: new Date().toISOString(), ...datos })
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'n8n tardó demasiado en responder.'
      : 'no hubo respuesta de n8n. Revisa la URL, que el flujo esté activo y que el webhook permita el origen de esta página (CORS).');
  } finally {
    clearTimeout(reloj);
  }

  if (r.status === 401 || r.status === 403) throw new Error('n8n rechazó el token. Revísalo en Ajustes.');
  if (r.status === 429) throw new Error('n8n está frenando los envíos. Intenta de nuevo en unos minutos.');
  if (r.status === 404) throw new Error('n8n no encontró ese webhook. Si el flujo está en modo prueba, actívalo o usa la URL de prueba.');
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.text()).slice(0, 140); } catch {}
    throw new Error(`n8n respondió ${r.status}. ${detalle}`);
  }
  return r;
}

const correoValido = c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c || '').trim());
const correoDelDominio = c => !config.dominioCorreo ||
  String(c || '').trim().toLowerCase().endsWith('@' + config.dominioCorreo.toLowerCase());

/* ── Códigos por correo ──────────────────────────────────── */
const enmascarar = c => String(c || '').replace(/^(.).*(@.*)$/, (m, a, b) => a + '•••' + b);

async function enviarCodigoCorreo(u, usuarios) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const sal = uid();
  const otp = { hash: await hashClave(codigo, sal), sal, expira: Date.now() + 15 * 60 * 1000, intentos: 0 };

  await llamarWebhook({
    tipo: 'codigo',
    para: u.correo,
    nombre: u.nombre,
    codigo,
    vigenciaMinutos: 15
  });

  u.otp = otp;
  guardar(K.usuarios, usuarios);
}

$('#rec-enviar').addEventListener('click', async () => {
  const cedula = $('#rec-cedula').value.trim();
  if (!config.correoRecuperacion)
    return aviso('La recuperación por correo está apagada. Usa el código de administrador.', 'error');
  if (!cedula) return aviso('Escribe tu número de identificación.', 'error');

  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.cedula === cedula && x.activo !== false);
  const generico = 'Si esa identificación está registrada con un correo, allí llegará el código. Vence en 15 minutos.';

  $('#rec-aviso-envio').textContent = 'Enviando…';
  if (!u || !u.correo) { $('#rec-aviso-envio').textContent = generico; return; }

  try {
    await enviarCodigoCorreo(u, usuarios);
    $('#rec-aviso-envio').textContent = `Código enviado a ${enmascarar(u.correo)}. Vence en 15 minutos.`;
  } catch (err) {
    $('#rec-aviso-envio').textContent = 'No se pudo enviar el correo: ' + err.message;
  }
});

/* ── Códigos de recuperación del administrador ───────────── */
const soloDigitos = s => String(s ?? '').replace(/\D/g, '');

function nuevoCodigo() {
  let d = '';
  for (let i = 0; i < 12; i++) d += Math.floor(Math.random() * 10);
  return d.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3');
}

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

Guarda este archivo fuera de la tableta.`;
  abrirModal('modal-codigo');
}

$('#codigo-listo').addEventListener('click', () => cerrarModal('modal-codigo'));
$('#codigo-descargar').addEventListener('click', () =>
  descargar(`acceso_tienda_${hoy()}.txt`, textoCodigo, 'text/plain'));

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

  if (u.otp && Date.now() < u.otp.expira && (u.otp.intentos || 0) < 5) {
    if (await hashClave(codigo, u.otp.sal) === u.otp.hash) valido = true;
    else { u.otp.intentos = (u.otp.intentos || 0) + 1; guardar(K.usuarios, usuarios); }
  }
  if (!valido && u.rol === 'admin' && u.recuperacion &&
      await hashClave(codigo, u.salRec) === u.recuperacion) { valido = true; usoCodigoAdmin = true; }
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
      texto: 'Ya puedes entrar con la contraseña nueva. Este es tu código de recuperación actualizado.',
      extra: [['Identificación', u.cedula], ['Nombre', u.nombre]]
    });
  } else {
    aviso('Contraseña cambiada. Ya puedes entrar.', 'ok');
  }
});

/* ── Mi cuenta ───────────────────────────────────────────── */
function abrirCuenta(texto = '') {
  $('#cuenta-texto').textContent = texto;
  $('#cuenta-aviso').textContent = '';
  $('#cuenta-datos').innerHTML =
    `<div><span>Nombre</span><b>${esc(usuario.nombre)}</b></div>
     <div><span>Identificación</span><b>${esc(usuario.cedula)}</b></div>
     <div><span>Rol</span><b>${usuario.rol === 'admin' ? 'Administrador' : 'Empleado'}</b></div>`;
  $('#cuenta-correo').value = usuario.correo || '';
  abrirModal('modal-cuenta');
}

$('#btn-mi-cuenta').addEventListener('click', () =>
  abrirCuenta('Revisa que tu correo esté bien escrito: es el que recibe el código si olvidas la contraseña.'));

$('#cuenta-guardar').addEventListener('click', () => {
  const correo = $('#cuenta-correo').value.trim();
  if (correo && !correoValido(correo)) return aviso('Ese correo no parece válido.', 'error');
  if (correo && !correoDelDominio(correo))
    return aviso(`El correo debe ser del dominio ${config.dominioCorreo}.`, 'error');

  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.id === usuario.id); if (!u) return;
  u.correo = correo;
  if (!guardar(K.usuarios, usuarios)) return;
  usuario = u;
  aviso('Correo actualizado', 'ok');
});

$('#cuenta-probar').addEventListener('click', async () => {
  const correo = $('#cuenta-correo').value.trim();
  if (!correoValido(correo)) return aviso('Escribe un correo válido antes de probar.', 'error');
  $('#cuenta-aviso').textContent = 'Enviando…';
  try {
    await llamarWebhook({ tipo: 'prueba', para: correo, nombre: usuario.nombre });
    $('#cuenta-aviso').textContent = 'Mensaje enviado. Revisa tu bandeja: si no llega, el correo está mal escrito o el flujo de n8n no está funcionando.';
  } catch (err) {
    $('#cuenta-aviso').textContent = 'No se pudo enviar: ' + err.message;
  }
});

$('#cuenta-clave').addEventListener('click', () => {
  cerrarModal('modal-cuenta');
  abrirCambioClave(false);
});

/* ── Cambio de contraseña ────────────────────────────────── */
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

$('#clave-cancelar').addEventListener('click', () => cerrarModal('modal-cambiar-clave'));

$('#clave-guardar').addEventListener('click', async () => {
  const nueva = $('#clave-nueva').value.trim();
  const nueva2 = $('#clave-nueva2').value.trim();
  if (nueva.length < 4) return aviso('La contraseña necesita al menos 4 dígitos.', 'error');
  if (nueva !== nueva2) return aviso('Las dos contraseñas no coinciden.', 'error');

  const usuarios = leerUsuarios();
  const u = usuarios.find(x => x.id === usuario.id); if (!u) return;

  if (!cambioObligatorio) {
    if (await hashClave($('#clave-actual').value, u.sal) !== u.clave)
      return aviso('La contraseña actual no coincide.', 'error');
  }
  if (nueva === (config.claveGenerica || ''))
    return aviso('Elige una contraseña distinta de la genérica.', 'error');

  u.sal = uid();
  u.clave = await hashClave(nueva, u.sal);
  u.debeCambiar = false;
  delete u.otp;
  if (!guardar(K.usuarios, usuarios)) return;

  usuario = u;
  const era = cambioObligatorio;
  cambioObligatorio = false;
  $('#modal-cambiar-clave').classList.remove('fijo');
  cerrarModal('modal-cambiar-clave');
  aviso('Contraseña actualizada', 'ok');
  if (era) setTimeout(() => abrirCuenta('Confirma que este es tu correo. Es el que recibirá el código si olvidas la contraseña.'), 400);
});

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
  const bajos = productosBajos();
  if (bajos.length) aviso(`Hay ${bajos.length} producto(s) agotados o por acabarse. Revisa Inventario.`, 'error');
});
$('#btn-volver-tienda').addEventListener('click', () => mostrar('pantalla-tienda'));

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

/* ── Escáner y carrito ───────────────────────────────────── */
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
  $('#btn-pagar-nomina').disabled = carrito.length === 0;
}

$('#lista-carrito').addEventListener('click', e => {
  const mas = e.target.dataset.mas, menos = e.target.dataset.menos;
  if (mas !== undefined) {
    const i = carrito[+mas];
    const p = productos.find(x => x.numero === i.numero);
    if (p && p.bloquear !== false && i.cantidad + 1 > Number(p.stock || 0)) {
      return aviso(`Solo quedan ${Number(p.stock || 0)} de ${p.nombre}.`, 'error');
    }
    i.cantidad++;
  }
  if (menos !== undefined && --carrito[+menos].cantidad <= 0) carrito.splice(+menos, 1);
  if (mas !== undefined || menos !== undefined) pintarCarrito();
});

$('#btn-vaciar').addEventListener('click', () => { carrito = []; pintarCarrito(); enfocarEscaner(); });

function pintarRejilla() {
  const cont = $('#rejilla-productos');
  const lista = productos.filter(p => p.activo !== false);
  cont.innerHTML = '';
  if (!lista.length) { cont.innerHTML = '<p class="vacio">Todavía no hay productos cargados.</p>'; return; }
  lista.forEach(p => {
    const quedan = Number(p.stock || 0);
    const agotado = p.bloquear !== false && quedan <= 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'producto' + (agotado ? ' agotado' : '');
    b.disabled = agotado;
    const etiqueta = agotado ? 'Agotado'
      : (quedan > 0 && quedan <= Number(p.minimo || 0) ? `Quedan ${quedan}` : '');
    b.innerHTML = `
      <div class="producto-foto">
        ${p.foto ? `<img src="${p.foto}" alt="">` : '<span class="sinfoto">◻</span>'}
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

  try {
    estado.textContent = 'Preparando el lector…';
    if (!window.ZXing) await cargarScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js');
    lectorZX = new window.ZXing.BrowserMultiFormatReader();
    await lectorZX.decodeFromVideoDevice(null, video, r => { if (r) codigoCapturado(r.getText()); });
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

/* ── Confirmar pedido ────────────────────────────────────── */
$('#btn-pagar-nomina').addEventListener('click', () => {
  $('#nomina-total').textContent = money(totalCarrito());
  const acum = leerPedidos()
    .filter(p => p.usuarioId === usuario.id && p.estado === 'pendiente')
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
  guardarPedido();
});

function guardarPedido() {
  const pedido = {
    id: uid(), folio: folioNuevo(),
    usuarioId: usuario.id, nombre: usuario.nombre, cedula: usuario.cedula,
    items: carrito.map(i => ({ ...i })),
    total: totalCarrito(),
    metodo: 'nomina', estado: 'pendiente',
    historial: [], creado: new Date().toISOString()
  };
  const pedidos = leerPedidos();
  pedidos.push(pedido);
  if (!guardar(K.pedidos, pedidos)) return;
  descontarInventario(pedido.items, pedido.folio);
  pintarRejilla();

  $('#recibo-folio').textContent = pedido.folio;
  $('#recibo-lista').innerHTML = pedido.items.map(i =>
    `<li>${miniatura(i.numero)}<div class="nom"><b>${esc(i.nombre)}</b><span>${i.cantidad} × ${money(i.precio)}</span></div>
     <div></div><div class="precio">${money(i.precio * i.cantidad)}</div></li>`).join('');
  $('#recibo-total').textContent = money(pedido.total);
  $('#recibo-metodo').textContent = 'Se descontará de tu nómina. Guarda el código del pedido.';

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
  const pendiente = mios.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);

  $('#historial-resumen').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${mios.length}</b></div>
    <div><span class="eyebrow">Total comprado</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Pendiente de descuento</span><b>${money(pendiente)}</b></div>`;

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
    productos: pintarProductos, inventario: pintarInventario, usuarios: pintarUsuarios,
    pedidos: pintarPedidos, ajustes: pintarAjustes, respaldo: pintarEspacio
  }[b.dataset.panel] || (() => {}))();
});

/* ── Productos ───────────────────────────────────────────── */
let fotoProducto = '';

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
    stock: Number($('#prod-stock').value || 0),
    minimo: Number($('#prod-minimo').value || 0),
    bloquear: $('#prod-bloquear').checked,
    activo: true
  };

  let anterior = null;
  if (id) {
    const p = productos.find(x => x.id === id);
    anterior = Number(p.stock || 0);
    Object.assign(p, datos, { activo: p.activo });
  } else {
    productos.push({ id: uid(), ...datos });
  }

  if (!guardar(K.productos, productos)) { refrescarProductos(); return; }

  const delta = datos.stock - (anterior === null ? 0 : anterior);
  if (delta !== 0) {
    registrarMovimiento({
      numero: datos.numero, producto: datos.nombre,
      tipo: anterior === null ? 'entrada' : 'ajuste',
      cantidad: delta, saldo: datos.stock,
      motivo: anterior === null ? 'Existencias iniciales' : 'Ajuste desde la ficha del producto'
    });
  }

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
  $('#prod-stock').value = 0;
  $('#prod-minimo').value = 5;
  $('#prod-bloquear').checked = true;
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
    <thead><tr><th>Foto</th><th>N.º</th><th>Código de barras</th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th class="num">Quedan</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td>${p.foto ? `<img class="mini-foto" src="${p.foto}" alt="">` : '<div class="mini-foto-vacia">·</div>'}</td>
        <td class="cod">${esc(p.numero)}</td>
        <td class="cod">${esc(p.codigo || '—')}</td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria || '—')}</td>
        <td class="num">${money(p.precio)}</td>
        <td class="num">${Number(p.stock || 0)}</td>
        <td>${p.activo === false ? '<span class="marca marca-inactivo">Oculto</span>' : `<span class="marca marca-${estadoStock(p).clase}">${estadoStock(p).texto}</span>`}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-editar-p="${p.id}">Editar</button>
          <button type="button" class="btn btn-fantasma mini" data-alternar-p="${p.id}">${p.activo === false ? 'Mostrar' : 'Ocultar'}</button>
          <button type="button" class="btn btn-fantasma mini" data-borrar-p="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="9" class="vacio">Aún no hay productos.</td></tr>'}</tbody>`;
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
    $('#prod-stock').value = Number(p.stock || 0);
    $('#prod-minimo').value = Number(p.minimo || 0);
    $('#prod-bloquear').checked = p.bloquear !== false;
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

function columnasCSV(linea) {
  return linea.split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, ''));
}

$('#importar-productos').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const filas = (await archivo.text()).split(/\r?\n/).filter(l => l.trim());
  let indices = { numero: 0, codigo: 1, nombre: 2, precio: 3, categoria: 4 };
  let inicio = 0;

  const cabecera = columnasCSV(filas[0]).map(c => c.toLowerCase());
  if (cabecera.some(c => ['numero','número','codigo','código','nombre'].includes(c))) {
    indices = {
      numero: cabecera.findIndex(c => c === 'numero' || c === 'número'),
      codigo: cabecera.findIndex(c => c === 'codigo' || c === 'código'),
      nombre: cabecera.findIndex(c => c === 'nombre'),
      precio: cabecera.findIndex(c => c === 'precio'),
      categoria: cabecera.findIndex(c => c === 'categoria' || c === 'categoría'),
      existencias: cabecera.findIndex(c => c === 'existencias' || c === 'stock'),
      minimo: cabecera.findIndex(c => c === 'minimo' || c === 'mínimo')
    };
    inicio = 1;
  }

  let nuevos = 0;
  for (let i = inicio; i < filas.length; i++) {
    const c = columnasCSV(filas[i]);
    const dato = k => (indices[k] >= 0 ? c[indices[k]] : '') || '';
    const nombre = dato('nombre'), precio = dato('precio');
    if (!nombre || isNaN(Number(precio))) continue;

    let numero = dato('numero');
    const codigo = dato('codigo');
    const existente = productos.find(p => (numero && p.numero === numero) || (codigo && p.codigo === codigo));
    if (existente) {
      Object.assign(existente, {
        nombre, precio: Number(precio),
        categoria: dato('categoria') || existente.categoria,
        codigo: codigo || existente.codigo
      });
      if (dato('existencias') !== '') existente.stock = Number(dato('existencias'));
      if (dato('minimo') !== '') existente.minimo = Number(dato('minimo'));
    } else {
      if (!numero) numero = siguienteNumero(productos);
      if (numero.length === 1) numero = '0' + numero;
      productos.push({
        id: uid(), numero, codigo, nombre, precio: Number(precio),
        categoria: dato('categoria'), foto: '',
        stock: Number(dato('existencias') || 0), minimo: Number(dato('minimo') || 5),
        bloquear: true, activo: true
      });
      nuevos++;
    }
  }
  guardar(K.productos, productos);
  pintarProductos(); pintarRejilla();
  aviso(`Importación lista. ${nuevos} productos nuevos.`, 'ok');
  e.target.value = '';
});

$('#exportar-productos').addEventListener('click', () => {
  const filas = [['numero','codigo','nombre','precio','categoria','existencias','minimo']].concat(
    productos.map(p => [p.numero, p.codigo || '', p.nombre, p.precio, p.categoria || '', Number(p.stock || 0), Number(p.minimo || 0)]));
  descargar('productos.csv', aCSV(filas), 'text/csv');
});

/* ── Usuarios ────────────────────────────────────────────── */
$('#form-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#usr-id').value;
  const cedula = $('#usr-cedula').value.trim();
  const clave = $('#usr-clave').value.trim();
  const correo = $('#usr-correo').value.trim();
  const usuarios = leerUsuarios();

  if (usuarios.some(u => u.cedula === cedula && u.id !== id))
    return aviso('Ya hay alguien con esa identificación.', 'error');
  if (!id && clave.length < 4)
    return aviso('La contraseña necesita al menos 4 dígitos.', 'error');
  if (correo && !correoValido(correo))
    return aviso('Ese correo no parece válido.', 'error');
  if (correo && !correoDelDominio(correo))
    return aviso(`El correo debe ser del dominio ${config.dominioCorreo}.`, 'error');

  let afectado;
  if (id) {
    afectado = usuarios.find(x => x.id === id);
    afectado.nombre = $('#usr-nombre').value.trim();
    afectado.cedula = cedula;
    afectado.correo = correo;
    afectado.rol = $('#usr-rol').value;
    afectado.debeCambiar = $('#usr-cambiar').checked;
    if (clave) { afectado.sal = uid(); afectado.clave = await hashClave(clave, afectado.sal); }
  } else {
    const sal = uid();
    afectado = {
      id: uid(), nombre: $('#usr-nombre').value.trim(), cedula, correo,
      rol: $('#usr-rol').value, sal, clave: await hashClave(clave, sal),
      activo: true, debeCambiar: $('#usr-cambiar').checked, creado: new Date().toISOString()
    };
    usuarios.push(afectado);
  }

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
    <thead><tr><th>Identificación</th><th>Nombre</th><th>Correo</th><th>Rol</th><th class="num">Pedidos</th><th class="num">Pendiente</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(u => {
      const mios = pedidos.filter(p => p.usuarioId === u.id);
      const deuda = mios.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
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

$('#importar-usuarios').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const filas = (await archivo.text()).split(/\r?\n/).filter(l => l.trim());
  const cabecera = columnasCSV(filas[0]).map(c => c.toLowerCase());
  const tiene = cabecera.some(c => ['identificacion','identificación','cedula','cédula','nombre'].includes(c));
  const idx = tiene ? {
    cedula: cabecera.findIndex(c => ['identificacion','identificación','cedula','cédula'].includes(c)),
    nombre: cabecera.findIndex(c => c === 'nombre'),
    correo: cabecera.findIndex(c => c === 'correo' || c === 'email')
  } : { cedula: 0, nombre: 1, correo: 2 };

  const usuarios = leerUsuarios();
  let nuevos = 0;
  for (let i = tiene ? 1 : 0; i < filas.length; i++) {
    const c = columnasCSV(filas[i]);
    const cedula = (idx.cedula >= 0 ? c[idx.cedula] : '') || '';
    const nombre = (idx.nombre >= 0 ? c[idx.nombre] : '') || '';
    const correo = (idx.correo >= 0 ? c[idx.correo] : '') || '';
    if (!cedula || !nombre) continue;
    const existente = usuarios.find(u => u.cedula === cedula);
    if (existente) { existente.nombre = nombre; if (correo) existente.correo = correo; continue; }
    const sal = uid();
    usuarios.push({
      id: uid(), nombre, cedula, correo, rol: 'empleado', sal,
      clave: await hashClave(config.claveGenerica || '1234', sal),
      activo: true, debeCambiar: true, creado: new Date().toISOString()
    });
    nuevos++;
  }
  guardar(K.usuarios, usuarios);
  pintarUsuarios();
  aviso(`Importación lista. ${nuevos} usuarios nuevos con la contraseña genérica.`, 'ok');
  e.target.value = '';
});

$('#exportar-usuarios').addEventListener('click', () => {
  const filas = [['identificacion','nombre','correo','rol','activo']].concat(
    leerUsuarios().map(u => [u.cedula, u.nombre, u.correo || '', u.rol, u.activo === false ? 'no' : 'si']));
  descargar('usuarios.csv', aCSV(filas), 'text/csv');
});

/* ── Inventario ──────────────────────────────────────────── */
function estadoStock(p) {
  const s = Number(p.stock || 0), m = Number(p.minimo || 0);
  if (s <= 0) return { texto: 'Agotado', clase: 'agotado' };
  if (s <= m) return { texto: 'Por acabarse', clase: 'pendiente' };
  return { texto: 'Disponible', clase: 'ok' };
}

function registrarMovimiento(mov) {
  const lista = leerMovimientos();
  lista.unshift({ id: uid(), fecha: new Date().toISOString(), por: usuario?.nombre || 'Sistema', ...mov });
  guardar(K.movimientos, lista.slice(0, 500));
}

function productosBajos() {
  return productos.filter(p => p.activo !== false && Number(p.stock || 0) <= Number(p.minimo || 0));
}

/* Descuenta del inventario los productos de un pedido. */
function descontarInventario(items, folio) {
  let cambio = false;
  items.forEach(i => {
    const p = productos.find(x => x.numero === i.numero);
    if (!p) return;
    p.stock = Number(p.stock || 0) - i.cantidad;
    cambio = true;
    registrarMovimiento({
      numero: p.numero, producto: p.nombre, tipo: 'venta',
      cantidad: -i.cantidad, saldo: p.stock, motivo: 'Pedido ' + folio
    });
  });
  if (cambio) guardar(K.productos, productos);
}

function pintarSelectorProductos() {
  const sel = $('#inv-producto');
  const previo = sel.value;
  sel.innerHTML = productos.map(p =>
    `<option value="${esc(p.numero)}">${esc(p.numero)} · ${esc(p.nombre)} (${Number(p.stock || 0)})</option>`).join('');
  if (previo) sel.value = previo;
}

$('#form-movimiento').addEventListener('submit', e => {
  e.preventDefault();
  if (usuario?.rol !== 'admin') return;
  const p = productos.find(x => x.numero === $('#inv-producto').value);
  if (!p) return aviso('Elige un producto.', 'error');

  const cantidad = Number($('#inv-cantidad').value);
  if (isNaN(cantidad) || cantidad < 0) return aviso('Escribe una cantidad válida.', 'error');

  const tipo = $('#inv-tipo').value;
  const motivo = $('#inv-motivo').value.trim();
  const antes = Number(p.stock || 0);

  if (tipo === 'entrada') p.stock = antes + cantidad;
  if (tipo === 'baja')    p.stock = antes - cantidad;
  if (tipo === 'ajuste')  p.stock = cantidad;

  const delta = Number(p.stock) - antes;
  if (!guardar(K.productos, productos)) return;
  registrarMovimiento({
    numero: p.numero, producto: p.nombre, tipo,
    cantidad: delta, saldo: p.stock,
    motivo: motivo || { entrada: 'Entrada de mercancía', baja: 'Baja', ajuste: 'Conteo físico' }[tipo]
  });

  $('#inv-cantidad').value = '';
  $('#inv-motivo').value = '';
  pintarInventario(); pintarProductos(); pintarRejilla();
  aviso(`${p.nombre}: quedan ${p.stock}`, 'ok');
});

$('#inv-solo-bajos').addEventListener('change', pintarInventario);

function filasInventario() {
  const soloBajos = $('#inv-solo-bajos').checked;
  return productos
    .filter(p => !soloBajos || Number(p.stock || 0) <= Number(p.minimo || 0))
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

function pintarInventario() {
  pintarSelectorProductos();

  const activos = productos.filter(p => p.activo !== false);
  const unidades = activos.reduce((s, p) => s + Number(p.stock || 0), 0);
  const valor = activos.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precio || 0), 0);
  const agotados = activos.filter(p => Number(p.stock || 0) <= 0).length;
  const bajos = productosBajos().length - agotados;

  $('#resumen-inventario').innerHTML = `
    <div><span class="eyebrow">Productos</span><b>${activos.length}</b></div>
    <div><span class="eyebrow">Unidades en tienda</span><b>${unidades}</b></div>
    <div><span class="eyebrow">Valor del inventario</span><b>${money(valor)}</b></div>
    <div><span class="eyebrow">Por acabarse</span><b>${bajos}</b></div>
    <div><span class="eyebrow">Agotados</span><b>${agotados}</b></div>`;

  const lista = filasInventario();
  $('#tabla-inventario').innerHTML = `
    <thead><tr><th>N.º</th><th>Producto</th><th>Categoría</th><th class="num">Quedan</th><th class="num">Avisar en</th><th class="num">Valor</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => {
      const e = estadoStock(p);
      return `<tr>
        <td class="cod">${esc(p.numero)}</td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria || '—')}</td>
        <td class="num">${Number(p.stock || 0)}</td>
        <td class="num">${Number(p.minimo || 0)}</td>
        <td class="num">${money(Number(p.stock || 0) * Number(p.precio || 0))}</td>
        <td><span class="marca marca-${e.clase}">${e.texto}</span>${p.bloquear === false ? '<br><small>sin bloqueo</small>' : ''}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-sumar="${esc(p.numero)}">+1</button>
          <button type="button" class="btn btn-fantasma mini" data-restar="${esc(p.numero)}">−1</button>
        </div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="vacio">Nada por aquí con ese filtro.</td></tr>'}</tbody>`;

  const movs = leerMovimientos().slice(0, 60);
  $('#tabla-movimientos').innerHTML = `
    <thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th class="num">Cambio</th><th class="num">Saldo</th><th>Motivo</th><th>Quién</th></tr></thead>
    <tbody>${movs.length ? movs.map(m => `
      <tr>
        <td>${fecha(m.fecha)}</td>
        <td>${esc(m.numero)} · ${esc(m.producto)}</td>
        <td>${({ entrada: 'Entrada', venta: 'Venta', baja: 'Baja', ajuste: 'Ajuste' })[m.tipo] || esc(m.tipo)}</td>
        <td class="num">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td class="num">${m.saldo}</td>
        <td>${esc(m.motivo || '—')}</td>
        <td>${esc(m.por || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="vacio">Todavía no hay movimientos.</td></tr>'}</tbody>`;
}

$('#tabla-inventario').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (usuario?.rol !== 'admin') return;
  const numero = b.dataset.sumar || b.dataset.restar;
  const p = productos.find(x => x.numero === numero); if (!p) return;
  const delta = b.dataset.sumar ? 1 : -1;
  p.stock = Number(p.stock || 0) + delta;
  if (!guardar(K.productos, productos)) return;
  registrarMovimiento({
    numero: p.numero, producto: p.nombre, tipo: delta > 0 ? 'entrada' : 'baja',
    cantidad: delta, saldo: p.stock, motivo: 'Corrección rápida'
  });
  pintarInventario(); pintarProductos(); pintarRejilla();
});

const CAB_INVENTARIO = ['N.º','Código','Producto','Categoría','Precio','Quedan','Avisar en','Valor','Estado'];

function reporteInventario() {
  const lista = filasInventario();
  return {
    tipo: 'inventario',
    titulo: 'Inventario de la tienda',
    periodo: `Corte del ${new Date().toLocaleString('es-CO')}`,
    cabeceras: CAB_INVENTARIO,
    filas: lista.map(p => [
      p.numero, p.codigo || '', p.nombre, p.categoria || '',
      Number(p.precio || 0), Number(p.stock || 0), Number(p.minimo || 0),
      Number(p.stock || 0) * Number(p.precio || 0), estadoStock(p).texto
    ]),
    columnasMoneda: [4, 7],
    total: lista.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precio || 0), 0),
    pendiente: 0,
    pedidos: lista.length
  };
}

$('#inv-csv').addEventListener('click', () => {
  const rep = reporteInventario();
  descargar(`inventario_${hoy()}.csv`, csvDeReporte(rep), 'text/csv');
});

$('#inv-pdf').addEventListener('click', async () => {
  aviso('Generando el PDF…');
  try {
    const doc = await pdfDeReporte(reporteInventario());
    doc.save(`inventario_${hoy()}.pdf`);
  } catch (err) { aviso('No se pudo generar el PDF: ' + err.message, 'error'); }
});

$('#inv-correo').addEventListener('click', async () => {
  if (!config.correo) return aviso('Escribe el correo que recibe los reportes en Ajustes.', 'error');
  const rep = reporteInventario();
  const bajos = productosBajos();
  const adjuntos = [{ nombre: `inventario_${hoy()}.csv`, tipo: 'text/csv', contenidoBase64: aBase64(csvDeReporte(rep)) }];
  try {
    const doc = await pdfDeReporte(rep);
    adjuntos.push({ nombre: `inventario_${hoy()}.pdf`, tipo: 'application/pdf', contenidoBase64: doc.output('datauristring').split(',')[1] });
  } catch { aviso('El PDF no se pudo generar; se envía solo el Excel.', 'error'); }

  const resumen = `${rep.titulo}
${rep.periodo}
Valor del inventario: ${money(rep.total)}
Por reponer: ${bajos.length ? bajos.map(p => `${p.nombre} (quedan ${Number(p.stock || 0)})`).join(', ') : 'nada por ahora'}`;

  try {
    await llamarWebhook({
      tipo: 'inventario', para: config.correo,
      asunto: `Inventario · ${config.empresa} · ${hoy()}`,
      resumen, adjuntos,
      porReponer: bajos.map(p => ({ numero: p.numero, nombre: p.nombre, quedan: Number(p.stock || 0), minimo: Number(p.minimo || 0) }))
    });
    aviso('Inventario enviado a ' + config.correo, 'ok');
  } catch (err) {
    aviso('No se pudo enviar: ' + err.message, 'error');
  }
});

$('#mov-csv').addEventListener('click', () => {
  const filas = [['fecha','numero','producto','movimiento','cambio','saldo','motivo','quien']].concat(
    leerMovimientos().map(m => [fecha(m.fecha), m.numero, m.producto, m.tipo, m.cantidad, m.saldo, m.motivo || '', m.por || '']));
  descargar(`movimientos_${hoy()}.csv`, aCSV(filas), 'text/csv');
});

/* ── Cambios de estado ───────────────────────────────────── */
function cambiarEstado(id, accion) {
  if (usuario?.rol !== 'admin') return aviso('Solo el administrador puede cambiar el estado.', 'error');
  const pedidos = leerPedidos();
  const p = pedidos.find(x => x.id === id); if (!p) return;
  p.historial = p.historial || [];
  const registrar = texto => p.historial.push({ fecha: new Date().toISOString(), texto, por: usuario.nombre });

  if (accion === 'conciliar') { p.estado = 'conciliado'; registrar('Descontado de nómina'); }
  if (accion === 'reabrir')   { p.estado = 'pendiente';  registrar('Reabierto'); }
  if (accion === 'borrar') {
    if (!confirm('¿Borrar este pedido? No se puede deshacer.')) return;
    guardar(K.pedidos, pedidos.filter(x => x.id !== id));
    pintarPedidos(); aviso('Pedido borrado', 'ok');
    return;
  }
  guardar(K.pedidos, pedidos);
  pintarPedidos();
  aviso('Pedido actualizado', 'ok');
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-accion][data-id]');
  if (b) cambiarEstado(b.dataset.id, b.dataset.accion);
});

/* ── Pedidos ─────────────────────────────────────────────── */
['#f-desde', '#f-hasta', '#f-estado', '#f-persona']
  .forEach(s => $(s).addEventListener('input', pintarPedidos));

function pedidosFiltrados() {
  const desde = $('#f-desde').value, hasta = $('#f-hasta').value;
  const estado = $('#f-estado').value;
  const q = $('#f-persona').value.trim().toLowerCase();
  return leerPedidos().filter(p => {
    const d = p.creado.slice(0, 10);
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
  const personas = new Set(lista.map(p => p.cedula)).size;

  $('#resumen-pedidos').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${lista.length}</b></div>
    <div><span class="eyebrow">Personas</span><b>${personas}</b></div>
    <div><span class="eyebrow">Total del período</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Pendiente de descuento</span><b>${money(pendiente)}</b></div>`;

  $('#rep-destino').textContent = config.correo
    ? `El reporte se enviará a ${config.correo} a través del flujo de n8n. Período: ${rotuloPeriodo().toLowerCase()}.`
    : 'Falta definir el correo que recibe los reportes en Ajustes.';

  const resumen = datosResumen(lista).filter(r => r.pedidos > 0);
  $('#tabla-nomina').innerHTML = `
    <thead><tr><th>Identificación</th><th>Nombre</th><th class="num">Pedidos</th><th class="num">Total</th><th class="num">Pendiente</th><th></th></tr></thead>
    <tbody>${resumen.length ? resumen.map(r => `
      <tr><td class="cod">${esc(r.cedula)}</td><td>${esc(r.nombre)}</td>
      <td class="num">${r.pedidos}</td><td class="num">${money(r.total)}</td><td class="num">${money(r.pendiente)}</td>
      <td><div class="tabla-acciones">${r.pendiente > 0
        ? `<button type="button" class="btn btn-fantasma mini" data-conciliar="${esc(r.cedula)}">Marcar descontado</button>`
        : ''}</div></td></tr>`).join('')
      : '<tr><td colspan="6" class="vacio">Nadie ha pedido en este período.</td></tr>'}</tbody>`;

  $('#tabla-pedidos').innerHTML = `
    <thead><tr><th>Código</th><th>Fecha</th><th>Persona</th><th>Productos</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td class="cod">${esc(p.folio)}</td>
        <td>${fecha(p.creado)}</td>
        <td>${esc(p.nombre)}<br><span class="cod">${esc(p.cedula)}</span></td>
        <td>${p.items.map(i => `${i.cantidad}× ${esc(i.nombre)}`).join('<br>')}</td>
        <td class="num">${money(p.total)}</td>
        <td>${marcaEstado(p.estado)}</td>
        <td><div class="tabla-acciones">
          <button type="button" class="btn btn-fantasma mini" data-accion="${p.estado === 'pendiente' ? 'conciliar' : 'reabrir'}" data-id="${p.id}">${p.estado === 'pendiente' ? 'Marcar descontado' : 'Reabrir'}</button>
          <button type="button" class="btn btn-fantasma mini" data-accion="borrar" data-id="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="7" class="vacio">No hay pedidos con estos filtros.</td></tr>'}</tbody>`;
}

$('#tabla-nomina').addEventListener('click', e => {
  const b = e.target.closest('[data-conciliar]'); if (!b) return;
  if (usuario?.rol !== 'admin') return;
  if (!confirm('¿Marcar como descontados todos los pedidos pendientes de esta persona?')) return;
  const pedidos = leerPedidos();
  pedidos.forEach(p => {
    if (p.cedula === b.dataset.conciliar && p.estado === 'pendiente') {
      p.estado = 'conciliado';
      (p.historial = p.historial || []).push({ fecha: new Date().toISOString(), texto: 'Descontado de nómina', por: usuario.nombre });
    }
  });
  guardar(K.pedidos, pedidos); pintarPedidos(); aviso('Pedidos marcados como descontados', 'ok');
});

/* ── Datos de los reportes ───────────────────────────────── */
/* Resumen: una fila por persona registrada, hayan pedido o no.
   Primero quienes más compraron; al final, en orden alfabético, los de cero. */
function datosResumen(lista) {
  const mapa = new Map();
  leerUsuarios().filter(u => u.activo !== false).forEach(u => {
    mapa.set(u.cedula, { cedula: u.cedula, nombre: u.nombre, correo: u.correo || '', pedidos: 0, total: 0, pendiente: 0 });
  });
  lista.forEach(p => {
    if (!mapa.has(p.cedula)) mapa.set(p.cedula, { cedula: p.cedula, nombre: p.nombre, correo: '', pedidos: 0, total: 0, pendiente: 0 });
    const r = mapa.get(p.cedula);
    r.pedidos++;
    r.total += p.total;
    if (p.estado === 'pendiente') r.pendiente += p.total;
  });
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

function filasDetallado(lista) {
  const filas = [];
  [...lista].sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es') || a.creado.localeCompare(b.creado)
  ).forEach(p => p.items.forEach(i => filas.push([
    p.cedula, p.nombre, p.folio, fechaCorta(p.creado),
    i.numero || '', i.nombre, i.cantidad, i.precio, i.precio * i.cantidad,
    (ESTADOS[p.estado] || {}).texto || p.estado
  ])));
  return filas;
}

const CAB_DETALLE = ['Identificación','Nombre','Pedido','Fecha','N.º','Producto','Cantidad','Precio','Subtotal','Estado'];
const CAB_RESUMEN = ['Identificación','Nombre','Pedidos','Total','Pendiente de descuento'];

function filasResumen(lista) {
  return datosResumen(lista).map(r => [r.cedula, r.nombre, r.pedidos, r.total, r.pendiente]);
}

function armarReporte(tipo) {
  const lista = pedidosFiltrados();
  const detalle = tipo === 'detallado';
  return {
    tipo,
    titulo: detalle ? 'Detalle de consumo por persona' : 'Resumen de consumo por persona',
    periodo: rotuloPeriodo(),
    cabeceras: detalle ? CAB_DETALLE : CAB_RESUMEN,
    filas: detalle ? filasDetallado(lista) : filasResumen(lista),
    columnasMoneda: detalle ? [7, 8] : [3, 4],
    total: lista.reduce((s, p) => s + p.total, 0),
    pendiente: lista.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.total, 0),
    pedidos: lista.length
  };
}

/* ── CSV ─────────────────────────────────────────────────── */
function aCSV(filas) {
  return '\uFEFF' + filas.map(f => f.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
}

function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvDeReporte(rep) {
  return aCSV([
    [rep.titulo], [config.empresa], [rep.periodo],
    [`Generado: ${new Date().toLocaleString('es-CO')}`], [],
    rep.cabeceras, ...rep.filas, [],
    ['', 'Total del período', '', rep.total],
    ['', 'Pendiente de descuento', '', rep.pendiente]
  ]);
}

/* ── PDF ─────────────────────────────────────────────────── */
async function cargarPDF() {
  if (!window.jspdf) await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!window.jspdf?.jsPDF) throw new Error('No se pudo cargar el generador de PDF.');
  try {
    if (!window.jspdf.__tabla) {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
      window.jspdf.__tabla = true;
    }
  } catch { /* seguimos con el diseño simple */ }
  return window.jspdf.jsPDF;
}

async function pdfDeReporte(rep) {
  const jsPDF = await cargarPDF();
  const doc = new jsPDF({ orientation: rep.cabeceras.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
  const ancho = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(config.empresa || 'Tienda interna', 40, 45);
  doc.setFontSize(12);
  doc.text(rep.titulo, 40, 64);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(rep.periodo, 40, 80);
  doc.text(`Generado el ${new Date().toLocaleString('es-CO')}`, 40, 93);
  doc.text(`Pedidos: ${rep.pedidos}   Total: ${money(rep.total)}   Pendiente: ${money(rep.pendiente)}`, 40, 106);
  doc.setTextColor(0);

  const cuerpo = rep.filas.map(f =>
    f.map((c, i) => rep.columnasMoneda.includes(i) ? money(c) : String(c)));

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head: [rep.cabeceras], body: cuerpo, startY: 122,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [16, 20, 24], textColor: 242 },
      alternateRowStyles: { fillColor: [244, 245, 241] },
      columnStyles: Object.fromEntries(rep.columnasMoneda.map(i => [i, { halign: 'right' }])),
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        const p = doc.internal.getNumberOfPages();
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text('Página ' + p, ancho - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
        doc.setTextColor(0);
      }
    });
  } else {
    let y = 130;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(rep.cabeceras.join('  |  '), 40, y);
    doc.setFont('helvetica', 'normal');
    y += 14;
    cuerpo.forEach(f => {
      if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 50; }
      doc.text(f.join('  |  ').slice(0, 180), 40, y);
      y += 12;
    });
  }
  return doc;
}

/* ── Botones de reporte ──────────────────────────────────── */
const nombreArchivo = (rep, ext) =>
  `${rep.tipo === 'detallado' ? 'detalle' : 'resumen'}_tienda_${hoy()}.${ext}`;

$('#rep-csv').addEventListener('click', () => {
  const rep = armarReporte($('#rep-tipo').value);
  if (!rep.filas.length) return aviso('No hay datos para ese reporte.', 'error');
  descargar(nombreArchivo(rep, 'csv'), csvDeReporte(rep), 'text/csv');
});

$('#rep-pdf').addEventListener('click', async () => {
  const rep = armarReporte($('#rep-tipo').value);
  if (!rep.filas.length) return aviso('No hay datos para ese reporte.', 'error');
  aviso('Generando el PDF…');
  try {
    const doc = await pdfDeReporte(rep);
    doc.save(nombreArchivo(rep, 'pdf'));
  } catch (err) { aviso('No se pudo generar el PDF: ' + err.message, 'error'); }
});

$('#rep-correo').addEventListener('click', async () => {
  if (!config.correo) return aviso('Escribe el correo que recibe los reportes en Ajustes.', 'error');
  const rep = armarReporte($('#rep-tipo').value);
  if (!rep.filas.length) return aviso('No hay datos para ese reporte.', 'error');

  aviso('Preparando el reporte…');
  const adjuntos = [{
    nombre: nombreArchivo(rep, 'csv'),
    tipo: 'text/csv',
    contenidoBase64: aBase64(csvDeReporte(rep))
  }];

  try {
    const doc = await pdfDeReporte(rep);
    adjuntos.push({
      nombre: nombreArchivo(rep, 'pdf'),
      tipo: 'application/pdf',
      contenidoBase64: doc.output('datauristring').split(',')[1]
    });
  } catch { aviso('El PDF no se pudo generar; se envía solo el Excel.', 'error'); }

  const resumenTexto =
`${rep.titulo}
${rep.periodo}
Pedidos: ${rep.pedidos}
Total del período: ${money(rep.total)}
Pendiente de descuento: ${money(rep.pendiente)}`;

  try {
    await llamarWebhook({
      tipo: 'reporte',
      para: config.correo,
      asunto: `${rep.titulo} · ${config.empresa} · ${hoy()}`,
      resumen: resumenTexto,
      periodo: rep.periodo,
      totales: { pedidos: rep.pedidos, total: rep.total, pendiente: rep.pendiente },
      adjuntos
    });
    aviso('Reporte enviado a ' + config.correo, 'ok');
  } catch (err) {
    aviso('No se pudo enviar: ' + err.message + '. Descarga los archivos y envíalos a mano.', 'error');
  }
});

/* ── Ajustes ─────────────────────────────────────────────── */
function pintarAjustes() {
  $('#cfg-empresa').value = config.empresa;
  $('#cfg-correo').value = config.correo;
  $('#cfg-moneda').value = config.moneda;
  $('#cfg-generica').value = config.claveGenerica || '';
  $('#cfg-dominio').value = config.dominioCorreo || '';
  $('#cfg-webhook').value = config.webhook || '';
  $('#cfg-token').value = config.token || '';
  $('#cfg-correo-recuperacion').checked = !!config.correoRecuperacion;
}

$('#form-ajustes').addEventListener('submit', e => {
  e.preventDefault();
  Object.assign(config, {
    empresa: $('#cfg-empresa').value.trim() || 'Tienda interna',
    correo: $('#cfg-correo').value.trim(),
    moneda: $('#cfg-moneda').value,
    claveGenerica: $('#cfg-generica').value.trim() || '1234',
    dominioCorreo: $('#cfg-dominio').value.trim(),
    webhook: $('#cfg-webhook').value.trim(),
    token: $('#cfg-token').value.trim(),
    correoRecuperacion: $('#cfg-correo-recuperacion').checked
  });
  guardar(K.config, config);
  $('#marca-empresa').textContent = config.empresa;
  document.title = config.empresa;
  pintarCarrito(); pintarRejilla();
  aviso('Ajustes guardados', 'ok');
});

$('#cfg-probar').addEventListener('click', async () => {
  const destino = $('#cfg-correo').value.trim();
  if (!correoValido(destino)) return aviso('Escribe primero el correo que recibe los reportes.', 'error');
  aviso('Enviando prueba…');
  try {
    await llamarWebhook({ tipo: 'prueba', para: destino, nombre: usuario?.nombre || 'Administrador' });
    aviso('Prueba enviada. Revisa la bandeja de ' + destino, 'ok');
  } catch (err) {
    aviso('No se pudo enviar: ' + err.message, 'error');
  }
});

/* ── Respaldo ────────────────────────────────────────────── */
function pintarEspacio() {
  let bytes = 0;
  Object.values(K).forEach(k => { bytes += (localStorage.getItem(k) || '').length; });
  $('#uso-espacio').textContent =
    `Espacio ocupado: ${(bytes / 1048576).toFixed(2)} MB de unos 5 MB disponibles. Las fotos de producto son lo que más pesa.`;
}

$('#respaldo-descargar').addEventListener('click', () => {
  descargar(`respaldo_tienda_${hoy()}.json`, JSON.stringify({
    version: 3, generado: new Date().toISOString(),
    usuarios: leerUsuarios(), productos, pedidos: leerPedidos(),
    movimientos: leerMovimientos(), config
  }), 'application/json');
});

$('#respaldo-cargar').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    const d = JSON.parse(await archivo.text());
    if (!d.usuarios || !d.productos) throw new Error('formato');
    if (!confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
    guardar(K.usuarios, d.usuarios);
    guardar(K.productos, d.productos);
    guardar(K.pedidos, d.pedidos || []);
    guardar(K.movimientos, d.movimientos || []);
    guardar(K.config, { ...CONFIG_BASE, ...(d.config || {}) });
    aviso('Copia restaurada. La página se recargará.', 'ok');
    setTimeout(() => location.reload(), 1200);
  } catch { aviso('Ese archivo no es una copia válida.', 'error'); }
  e.target.value = '';
});

$('#borrar-pedidos').addEventListener('click', () => {
  if (!confirm('¿Borrar los pedidos ya descontados?')) return;
  guardar(K.pedidos, leerPedidos().filter(p => p.estado !== 'conciliado'));
  pintarPedidos(); pintarEspacio();
  aviso('Pedidos descontados borrados', 'ok');
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
      texto: 'Esta tableta se acaba de configurar. Al entrar te pedirá cambiar la contraseña.',
      extra: [['Identificación', '0000'], ['Contraseña inicial', '1234']]
    });
    codigoInicial = null;
  }
})();
