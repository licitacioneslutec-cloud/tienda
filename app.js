/* ═══════════════════════════════════════════════════════════
   Tienda interna · versión 1
   Todo se guarda en el navegador de la tableta (localStorage).
   Descarga una copia de seguridad desde Administración › Respaldo.
   ═══════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const K = {
  usuarios : 'ti_usuarios',
  productos: 'ti_productos',
  pedidos  : 'ti_pedidos',
  config   : 'ti_config',
  sesion   : 'ti_sesion'
};

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hoy   = () => new Date().toISOString().slice(0, 10);
const esc   = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function folioNuevo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let f = '';
  for (let i = 0; i < 6; i++) f += letras[Math.floor(Math.random() * letras.length)];
  return f.slice(0, 3) + '-' + f.slice(3);
}

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

/* ── Datos ───────────────────────────────────────────────── */
const leerUsuarios  = () => LS.get(K.usuarios, []);
const leerProductos = () => LS.get(K.productos, []);
const leerPedidos   = () => LS.get(K.pedidos, []);

const CONFIG_BASE = {
  empresa: 'Tienda interna',
  correo: '',
  codigoCorto: '',
  instrucciones: 'Escanea el código con tu app de pagos y escribe abajo el número de aprobación.',
  qr: '',
  moneda: 'COP',
  usarFuncion: false
};

async function inicializarDatos() {
  config = { ...CONFIG_BASE, ...LS.get(K.config, {}) };
  LS.set(K.config, config);

  if (!localStorage.getItem(K.productos)) {
    LS.set(K.productos, [
      { id: uid(), codigo: '7702001010101', nombre: 'Café en vaso',      precio: 2500, categoria: 'Bebidas', activo: true },
      { id: uid(), codigo: '7702001010102', nombre: 'Agua 600 ml',       precio: 3000, categoria: 'Bebidas', activo: true },
      { id: uid(), codigo: '7702001010103', nombre: 'Galletas surtidas', precio: 4200, categoria: 'Snacks',  activo: true }
    ]);
  }

  if (!localStorage.getItem(K.usuarios)) {
    const sal = uid();
    LS.set(K.usuarios, [{
      id: uid(), nombre: 'Administrador', cedula: '0000', rol: 'admin',
      sal, clave: await hashClave('admin123', sal), activo: true, creado: new Date().toISOString()
    }]);
    $('#nota-admin').textContent = 'Primer ingreso: identificación 0000 y contraseña admin123. Cámbiala en Usuarios.';
  }
}

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
  LS.set(K.sesion, { id: u.id, ts: Date.now() });
  $('#tienda-usuario').textContent = u.nombre;
  $('#admin-usuario').textContent  = u.nombre;
  $('#btn-ir-admin').hidden = u.rol !== 'admin';
  carrito = [];
  pintarCarrito();
  pintarAtajos();
  mostrar('pantalla-tienda');
}

function cerrarSesion() {
  usuario = null; carrito = [];
  localStorage.removeItem(K.sesion);
  $('#form-login').reset();
  mostrar('pantalla-login');
}

/* ── Ingreso ─────────────────────────────────────────────── */
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const cedula = $('#login-cedula').value.trim();
  const clave  = $('#login-clave').value;
  const u = leerUsuarios().find(x => x.cedula === cedula && x.activo !== false);
  if (!u) return aviso('No encontramos esa identificación.', 'error');
  const h = await hashClave(clave, u.sal);
  if (h !== u.clave) return aviso('La contraseña no coincide.', 'error');
  abrirSesion(u);
});

$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-salir-admin').addEventListener('click', cerrarSesion);
$('#btn-ir-admin').addEventListener('click', () => { mostrar('pantalla-admin'); pintarProductos(); });
$('#btn-volver-tienda').addEventListener('click', () => mostrar('pantalla-tienda'));

/* ── Escáner y carrito ───────────────────────────────────── */
function enfocarEscaner() {
  if (!$('#pantalla-tienda').classList.contains('activa')) return;
  if ($('.modal.abierto')) return;
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

function agregarPorCodigo(codigo) {
  const p = leerProductos().find(x => x.codigo === codigo && x.activo !== false);
  if (!p) {
    aviso('Código no registrado: ' + codigo + '. Pídele al administrador que lo agregue.', 'error');
    return;
  }
  agregarProducto(p);
}

function agregarProducto(p) {
  const item = carrito.find(i => i.codigo === p.codigo);
  if (item) item.cantidad++;
  else carrito.push({ codigo: p.codigo, nombre: p.nombre, precio: Number(p.precio), cantidad: 1 });
  pintarCarrito();
  aviso(p.nombre + ' agregado', 'ok');
}

const totalCarrito = () => carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

function pintarCarrito() {
  const ul = $('#lista-carrito');
  ul.innerHTML = carrito.length ? '' : '<li class="vacio">Pasa el primer producto por el lector.</li>';
  carrito.forEach((i, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="nom"><b>${esc(i.nombre)}</b><span>${esc(i.codigo)} · ${money(i.precio)}</span></div>
      <div class="cant">
        <button data-menos="${idx}" aria-label="Quitar uno">−</button>
        <b>${i.cantidad}</b>
        <button data-mas="${idx}" aria-label="Agregar uno">+</button>
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

function pintarAtajos() {
  const cont = $('#atajos');
  const lista = leerProductos().filter(p => p.activo !== false).slice(0, 6);
  cont.innerHTML = '';
  lista.forEach(p => {
    const b = document.createElement('button');
    b.className = 'atajo';
    b.innerHTML = `<b>${esc(p.nombre)}</b><span>${money(p.precio)}</span>`;
    b.addEventListener('click', () => agregarProducto(p));
    cont.append(b);
  });
}

/* ── Modales ─────────────────────────────────────────────── */
function abrirModal(id) { $('#' + id).classList.add('abierto'); }
function cerrarModal(id) { $('#' + id).classList.remove('abierto'); enfocarEscaner(); }
$$('[data-cerrar]').forEach(b => b.addEventListener('click', e => cerrarModal(e.target.closest('.modal').id)));
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) cerrarModal(m.id); }));

/* Pago inmediato */
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
  if (ref.length < 4) return aviso('Escribe el número de aprobación del pago.', 'error');
  cerrarModal('modal-qr');
  guardarPedido('qr', ref);
});

/* Descuento por nómina */
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
  guardarPedido('nomina', '');
});

function guardarPedido(metodo, referencia) {
  const pedido = {
    id: uid(),
    folio: folioNuevo(),
    usuarioId: usuario.id,
    nombre: usuario.nombre,
    cedula: usuario.cedula,
    items: carrito.map(i => ({ ...i })),
    total: totalCarrito(),
    metodo,
    referencia,
    estado: 'pendiente',
    creado: new Date().toISOString()
  };
  const pedidos = leerPedidos();
  pedidos.push(pedido);
  LS.set(K.pedidos, pedidos);

  $('#recibo-folio').textContent = pedido.folio;
  $('#recibo-lista').innerHTML = pedido.items.map(i =>
    `<li><div class="nom"><b>${esc(i.nombre)}</b><span>${i.cantidad} × ${money(i.precio)}</span></div>
     <div></div><div class="precio">${money(i.precio * i.cantidad)}</div></li>`).join('');
  $('#recibo-total').textContent = money(pedido.total);
  $('#recibo-metodo').textContent = metodo === 'nomina'
    ? 'Se descontará de tu nómina. Guarda el código del pedido.'
    : 'Pago registrado con la referencia ' + referencia + '. Queda pendiente de verificación.';

  carrito = [];
  pintarCarrito();
  abrirModal('modal-recibo');
}

$('#recibo-listo').addEventListener('click', () => cerrarModal('modal-recibo'));

/* ── Administración: pestañas ────────────────────────────── */
$('#pestanas').addEventListener('click', e => {
  const b = e.target.closest('.pestana');
  if (!b) return;
  $$('.pestana').forEach(x => x.classList.remove('activa'));
  $$('.panel').forEach(x => x.classList.remove('activa'));
  b.classList.add('activa');
  $('#panel-' + b.dataset.panel).classList.add('activa');
  ({ productos: pintarProductos, usuarios: pintarUsuarios, pedidos: pintarPedidos, ajustes: pintarAjustes }[b.dataset.panel] || (() => {}))();
});

/* ── Productos ───────────────────────────────────────────── */
$('#form-producto').addEventListener('submit', e => {
  e.preventDefault();
  const id = $('#prod-id').value;
  const codigo = $('#prod-codigo').value.trim();
  const productos = leerProductos();
  if (productos.some(p => p.codigo === codigo && p.id !== id))
    return aviso('Ya existe un producto con ese código.', 'error');

  const datos = {
    codigo,
    nombre: $('#prod-nombre').value.trim(),
    precio: Number($('#prod-precio').value),
    categoria: $('#prod-categoria').value.trim(),
    activo: true
  };

  if (id) Object.assign(productos.find(p => p.id === id), datos);
  else productos.push({ id: uid(), ...datos });

  LS.set(K.productos, productos);
  limpiarFormProducto();
  pintarProductos();
  pintarAtajos();
  aviso('Producto guardado', 'ok');
});

function limpiarFormProducto() {
  $('#form-producto').reset();
  $('#prod-id').value = '';
  $('#prod-guardar').textContent = 'Agregar producto';
  $('#prod-cancelar').hidden = true;
}
$('#prod-cancelar').addEventListener('click', limpiarFormProducto);
$('#buscar-producto').addEventListener('input', pintarProductos);

function pintarProductos() {
  const q = $('#buscar-producto').value.trim().toLowerCase();
  const lista = leerProductos().filter(p =>
    !q || p.nombre.toLowerCase().includes(q) || p.codigo.includes(q));

  $('#tabla-productos').innerHTML = `
    <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(p => `
      <tr>
        <td class="cod">${esc(p.codigo)}</td>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria || '—')}</td>
        <td class="num">${money(p.precio)}</td>
        <td>${p.activo === false ? '<span class="marca marca-inactivo">Oculto</span>' : '<span class="marca marca-ok">A la venta</span>'}</td>
        <td><div class="tabla-acciones">
          <button class="btn btn-fantasma mini" data-editar-p="${p.id}">Editar</button>
          <button class="btn btn-fantasma mini" data-alternar-p="${p.id}">${p.activo === false ? 'Mostrar' : 'Ocultar'}</button>
          <button class="btn btn-fantasma mini" data-borrar-p="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6" class="vacio">Aún no hay productos. Agrega el primero arriba.</td></tr>'}</tbody>`;
}

$('#tabla-productos').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const productos = leerProductos();

  if (b.dataset.editarP) {
    const p = productos.find(x => x.id === b.dataset.editarP);
    $('#prod-id').value = p.id; $('#prod-codigo').value = p.codigo;
    $('#prod-nombre').value = p.nombre; $('#prod-precio').value = p.precio;
    $('#prod-categoria').value = p.categoria || '';
    $('#prod-guardar').textContent = 'Guardar cambios';
    $('#prod-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.alternarP) {
    const p = productos.find(x => x.id === b.dataset.alternarP);
    p.activo = p.activo === false;
    LS.set(K.productos, productos); pintarProductos(); pintarAtajos();
  }
  if (b.dataset.borrarP) {
    if (!confirm('¿Borrar este producto? Los pedidos anteriores no cambian.')) return;
    LS.set(K.productos, productos.filter(x => x.id !== b.dataset.borrarP));
    pintarProductos(); pintarAtajos(); aviso('Producto borrado', 'ok');
  }
});

$('#importar-productos').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const texto = await archivo.text();
  const filas = texto.split(/\r?\n/).filter(l => l.trim());
  const productos = leerProductos();
  let nuevos = 0;
  filas.forEach((linea, i) => {
    const c = linea.split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /codigo|código/i.test(c[0])) return;
    const [codigo, nombre, precio, categoria] = c;
    if (!codigo || !nombre || isNaN(Number(precio))) return;
    const existente = productos.find(p => p.codigo === codigo);
    if (existente) Object.assign(existente, { nombre, precio: Number(precio), categoria: categoria || existente.categoria });
    else { productos.push({ id: uid(), codigo, nombre, precio: Number(precio), categoria: categoria || '', activo: true }); nuevos++; }
  });
  LS.set(K.productos, productos);
  pintarProductos(); pintarAtajos();
  aviso(`Importación lista. ${nuevos} productos nuevos.`, 'ok');
  e.target.value = '';
});

$('#exportar-productos').addEventListener('click', () => {
  const filas = [['codigo', 'nombre', 'precio', 'categoria']].concat(
    leerProductos().map(p => [p.codigo, p.nombre, p.precio, p.categoria || '']));
  descargar('productos.csv', aCSV(filas), 'text/csv');
});

/* ── Usuarios ────────────────────────────────────────────── */
$('#form-usuario').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#usr-id').value;
  const cedula = $('#usr-cedula').value.trim();
  const clave = $('#usr-clave').value;
  const usuarios = leerUsuarios();

  if (usuarios.some(u => u.cedula === cedula && u.id !== id))
    return aviso('Ya hay alguien con esa identificación.', 'error');
  if (!id && clave.length < 4)
    return aviso('La contraseña necesita al menos 4 caracteres.', 'error');

  if (id) {
    const u = usuarios.find(x => x.id === id);
    u.nombre = $('#usr-nombre').value.trim();
    u.cedula = cedula;
    u.rol = $('#usr-rol').value;
    if (clave) { u.sal = uid(); u.clave = await hashClave(clave, u.sal); }
  } else {
    const sal = uid();
    usuarios.push({
      id: uid(), nombre: $('#usr-nombre').value.trim(), cedula, rol: $('#usr-rol').value,
      sal, clave: await hashClave(clave, sal), activo: true, creado: new Date().toISOString()
    });
  }
  LS.set(K.usuarios, usuarios);
  limpiarFormUsuario();
  pintarUsuarios();
  aviso('Usuario guardado', 'ok');
});

function limpiarFormUsuario() {
  $('#form-usuario').reset();
  $('#usr-id').value = '';
  $('#usr-guardar').textContent = 'Crear usuario';
  $('#usr-clave').placeholder = 'Mínimo 4 caracteres';
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
    <thead><tr><th>Identificación</th><th>Nombre</th><th>Rol</th><th class="num">Pedidos</th><th class="num">Pendiente nómina</th><th>Estado</th><th></th></tr></thead>
    <tbody>${lista.map(u => {
      const mios = pedidos.filter(p => p.usuarioId === u.id);
      const deuda = mios.filter(p => p.metodo === 'nomina' && p.estado === 'pendiente').reduce((s, p) => s + p.total, 0);
      return `<tr>
        <td class="cod">${esc(u.cedula)}</td>
        <td>${esc(u.nombre)}</td>
        <td>${u.rol === 'admin' ? 'Administrador' : 'Empleado'}</td>
        <td class="num">${mios.length}</td>
        <td class="num">${money(deuda)}</td>
        <td>${u.activo === false ? '<span class="marca marca-inactivo">Inactivo</span>' : '<span class="marca marca-ok">Activo</span>'}</td>
        <td><div class="tabla-acciones">
          <button class="btn btn-fantasma mini" data-editar-u="${u.id}">Editar</button>
          <button class="btn btn-fantasma mini" data-alternar-u="${u.id}">${u.activo === false ? 'Activar' : 'Desactivar'}</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>`;
}

$('#tabla-usuarios').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const usuarios = leerUsuarios();
  if (b.dataset.editarU) {
    const u = usuarios.find(x => x.id === b.dataset.editarU);
    $('#usr-id').value = u.id; $('#usr-nombre').value = u.nombre;
    $('#usr-cedula').value = u.cedula; $('#usr-rol').value = u.rol;
    $('#usr-clave').value = ''; $('#usr-clave').placeholder = 'Déjala vacía para no cambiarla';
    $('#usr-guardar').textContent = 'Guardar cambios';
    $('#usr-cancelar').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.alternarU) {
    const u = usuarios.find(x => x.id === b.dataset.alternarU);
    if (u.id === usuario.id) return aviso('No puedes desactivar tu propio usuario.', 'error');
    u.activo = u.activo === false;
    LS.set(K.usuarios, usuarios); pintarUsuarios();
  }
});

$('#exportar-usuarios').addEventListener('click', () => {
  const filas = [['identificacion', 'nombre', 'rol', 'activo']].concat(
    leerUsuarios().map(u => [u.cedula, u.nombre, u.rol, u.activo === false ? 'no' : 'si']));
  descargar('usuarios.csv', aCSV(filas), 'text/csv');
});

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
  const inmediato = total - nomina;

  $('#resumen-pedidos').innerHTML = `
    <div><span class="eyebrow">Pedidos</span><b>${lista.length}</b></div>
    <div><span class="eyebrow">Total vendido</span><b>${money(total)}</b></div>
    <div><span class="eyebrow">Para nómina</span><b>${money(nomina)}</b></div>
    <div><span class="eyebrow">Pago inmediato</span><b>${money(inmediato)}</b></div>`;

  const porPersona = {};
  lista.filter(p => p.metodo === 'nomina' && p.estado === 'pendiente').forEach(p => {
    const k = p.cedula;
    porPersona[k] = porPersona[k] || { nombre: p.nombre, cedula: p.cedula, pedidos: 0, total: 0 };
    porPersona[k].pedidos++; porPersona[k].total += p.total;
  });
  const resumen = Object.values(porPersona).sort((a, b) => b.total - a.total);

  $('#tabla-nomina').innerHTML = `
    <thead><tr><th>Identificación</th><th>Nombre</th><th class="num">Pedidos</th><th class="num">Total a descontar</th><th></th></tr></thead>
    <tbody>${resumen.length ? resumen.map(r => `
      <tr><td class="cod">${esc(r.cedula)}</td><td>${esc(r.nombre)}</td>
      <td class="num">${r.pedidos}</td><td class="num">${money(r.total)}</td>
      <td><div class="tabla-acciones"><button class="btn btn-fantasma mini" data-conciliar="${esc(r.cedula)}">Marcar descontado</button></div></td></tr>`).join('')
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
        <td><span class="marca marca-${p.estado === 'pendiente' ? 'pendiente' : 'ok'}">${p.estado === 'pendiente' ? 'Pendiente' : 'Conciliado'}</span></td>
        <td><div class="tabla-acciones">
          <button class="btn btn-fantasma mini" data-estado="${p.id}">${p.estado === 'pendiente' ? 'Conciliar' : 'Reabrir'}</button>
          <button class="btn btn-fantasma mini" data-borrar-o="${p.id}">Borrar</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="vacio">No hay pedidos con estos filtros.</td></tr>'}</tbody>`;
}

$('#tabla-nomina').addEventListener('click', e => {
  const b = e.target.closest('[data-conciliar]'); if (!b) return;
  if (!confirm('¿Marcar como descontados todos los pedidos pendientes de esta persona?')) return;
  const pedidos = leerPedidos();
  pedidos.forEach(p => {
    if (p.cedula === b.dataset.conciliar && p.metodo === 'nomina' && p.estado === 'pendiente') p.estado = 'conciliado';
  });
  LS.set(K.pedidos, pedidos); pintarPedidos(); aviso('Pedidos conciliados', 'ok');
});

$('#tabla-pedidos').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const pedidos = leerPedidos();
  if (b.dataset.estado) {
    const p = pedidos.find(x => x.id === b.dataset.estado);
    p.estado = p.estado === 'pendiente' ? 'conciliado' : 'pendiente';
    LS.set(K.pedidos, pedidos); pintarPedidos();
  }
  if (b.dataset.borrarO) {
    if (!confirm('¿Borrar este pedido? No se puede deshacer.')) return;
    LS.set(K.pedidos, pedidos.filter(x => x.id !== b.dataset.borrarO));
    pintarPedidos(); aviso('Pedido borrado', 'ok');
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
                  'codigo_producto', 'producto', 'precio_unitario', 'cantidad', 'subtotal', 'total_pedido']];
  lista.forEach(p => p.items.forEach(i => filas.push([
    p.folio, fecha(p.creado), p.cedula, p.nombre,
    p.metodo === 'nomina' ? 'Nómina' : 'Pago inmediato', p.estado, p.referencia || '',
    i.codigo, i.nombre, i.precio, i.cantidad, i.precio * i.cantidad, p.total
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
  const asunto = `Reporte de la tienda interna · ${hoy()}`;
  const cuerpo =
`Reporte de ${config.empresa}
Generado: ${new Date().toLocaleString('es-CO')}
Pedidos: ${lista.length}
Total vendido: ${money(total)}
Para descuento de nómina: ${money(nomina)}
Pago inmediato: ${money(total - nomina)}`;

  if (config.usarFuncion) {
    try {
      const r = await fetch('/.netlify/functions/enviar-reporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ para: config.correo, asunto, cuerpo, csv, nombreArchivo: `pedidos_${hoy()}.csv` })
      });
      if (!r.ok) throw new Error(await r.text());
      return aviso('Reporte enviado a ' + config.correo, 'ok');
    } catch (err) {
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
  $('#cfg-qr-vista').innerHTML = config.qr ? `<img src="${config.qr}" alt="Código QR de pago">` : '';
}

$('#cfg-qr-archivo').addEventListener('change', e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  if (archivo.size > 400000) return aviso('La imagen debe pesar menos de 400 KB.', 'error');
  const lector = new FileReader();
  lector.onload = () => {
    config.qr = lector.result;
    $('#cfg-qr-vista').innerHTML = `<img src="${config.qr}" alt="Código QR de pago">`;
    aviso('Imagen cargada. Guarda los ajustes.', 'ok');
  };
  lector.readAsDataURL(archivo);
});

$('#form-ajustes').addEventListener('submit', e => {
  e.preventDefault();
  Object.assign(config, {
    empresa: $('#cfg-empresa').value.trim() || 'Tienda interna',
    correo: $('#cfg-correo').value.trim(),
    codigoCorto: $('#cfg-codigo').value.trim(),
    instrucciones: $('#cfg-instrucciones').value.trim(),
    moneda: $('#cfg-moneda').value,
    usarFuncion: $('#cfg-funcion').checked
  });
  LS.set(K.config, config);
  $('#marca-empresa').textContent = config.empresa;
  document.title = config.empresa;
  pintarCarrito();
  aviso('Ajustes guardados', 'ok');
});

/* ── Respaldo ────────────────────────────────────────────── */
$('#respaldo-descargar').addEventListener('click', () => {
  const copia = {
    version: 1, generado: new Date().toISOString(),
    usuarios: leerUsuarios(), productos: leerProductos(), pedidos: leerPedidos(), config
  };
  descargar(`respaldo_tienda_${hoy()}.json`, JSON.stringify(copia, null, 2), 'application/json');
});

$('#respaldo-cargar').addEventListener('change', async e => {
  const archivo = e.target.files[0]; if (!archivo) return;
  try {
    const d = JSON.parse(await archivo.text());
    if (!d.usuarios || !d.productos) throw new Error('formato');
    if (!confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
    LS.set(K.usuarios, d.usuarios); LS.set(K.productos, d.productos);
    LS.set(K.pedidos, d.pedidos || []); LS.set(K.config, { ...CONFIG_BASE, ...(d.config || {}) });
    aviso('Copia restaurada. La página se recargará.', 'ok');
    setTimeout(() => location.reload(), 1200);
  } catch {
    aviso('Ese archivo no es una copia válida.', 'error');
  }
  e.target.value = '';
});

$('#borrar-pedidos').addEventListener('click', () => {
  if (!confirm('¿Borrar todos los pedidos ya conciliados?')) return;
  const quedan = leerPedidos().filter(p => p.estado !== 'conciliado');
  LS.set(K.pedidos, quedan);
  pintarPedidos();
  aviso('Pedidos conciliados borrados', 'ok');
});

/* ── Arranque ────────────────────────────────────────────── */
(async function arrancar() {
  await inicializarDatos();
  $('#marca-empresa').textContent = config.empresa;
  document.title = config.empresa;

  const s = LS.get(K.sesion, null);
  const u = s && leerUsuarios().find(x => x.id === s.id && x.activo !== false);
  if (u && Date.now() - s.ts < 12 * 60 * 60 * 1000) abrirSesion(u);
  else mostrar('pantalla-login');

  pintarCarrito();
})();
