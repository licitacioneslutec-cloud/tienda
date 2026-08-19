/* Envía por correo el código de recuperación de contraseña.

   Variables de entorno en Netlify:
     RESEND_API_KEY     → clave de https://resend.com (obligatoria)
     CORREO_ORIGEN      → remitente verificado (por defecto proyectos@lutec.com.co)
     DOMINIO_PERMITIDO  → solo se envía a correos de este dominio (por defecto lutec.com.co)

   El código en sí no sirve de nada sin la tableta: allí se guarda su huella
   cifrada y su vencimiento. Esta función solo entrega el mensaje. */

const ORIGEN  = process.env.CORREO_ORIGEN || 'proyectos@lutec.com.co';
const DOMINIO = (process.env.DOMINIO_PERMITIDO || 'lutec.com.co').toLowerCase();

// Freno sencillo contra el uso abusivo del endpoint.
const VENTANA = 15 * 60 * 1000;
const MAXIMO = 5;
const registro = new Map();

function demasiados(correo) {
  const ahora = Date.now();
  const previos = (registro.get(correo) || []).filter(t => ahora - t < VENTANA);
  previos.push(ahora);
  registro.set(correo, previos);
  if (registro.size > 500) registro.clear();
  return previos.length > MAXIMO;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

  const clave = process.env.RESEND_API_KEY;
  if (!clave) return new Response('Falta configurar RESEND_API_KEY en Netlify.', { status: 500 });

  let datos;
  try { datos = await req.json(); }
  catch { return new Response('Cuerpo inválido', { status: 400 }); }

  const para = String(datos.para || '').trim().toLowerCase();
  const codigo = String(datos.codigo || '').trim();
  const nombre = String(datos.nombre || '').slice(0, 80);
  const empresa = String(datos.empresa || 'Tienda interna').slice(0, 80);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return new Response('Correo inválido', { status: 400 });
  if (!para.endsWith('@' + DOMINIO)) return new Response('Ese correo no pertenece a la empresa', { status: 403 });
  if (!/^\d{4,8}$/.test(codigo)) return new Response('Código inválido', { status: 400 });
  if (demasiados(para)) return new Response('Demasiadas solicitudes. Intenta más tarde.', { status: 429 });

  const texto =
`Hola ${nombre || ''},

Tu código para cambiar la contraseña de ${empresa} es:

    ${codigo}

Escríbelo en la tableta, en la pantalla de ingreso. Vence en 15 minutos y solo
sirve una vez. Si no lo pediste, ignora este mensaje y avísale al administrador.`;

  const html =
`<div style="font-family:system-ui,sans-serif;font-size:15px;color:#101418">
  <p>Hola ${nombre || ''},</p>
  <p>Tu código para cambiar la contraseña de <b>${empresa}</b> es:</p>
  <p style="font-family:monospace;font-size:30px;letter-spacing:6px;font-weight:700;
            background:#F2F3EF;border:1px dashed #D8DAD3;border-radius:10px;
            padding:14px;text-align:center">${codigo}</p>
  <p>Escríbelo en la tableta, en la pantalla de ingreso. Vence en 15 minutos y solo sirve una vez.</p>
  <p style="color:#6B7280;font-size:13px">Si no lo pediste, ignora este mensaje y avísale al administrador.</p>
</div>`;

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ORIGEN, to: [para],
      subject: `Código para cambiar tu contraseña · ${empresa}`,
      text: texto, html
    })
  });

  if (!respuesta.ok) {
    return new Response('El servicio de correo rechazó el envío: ' + (await respuesta.text()), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
};
