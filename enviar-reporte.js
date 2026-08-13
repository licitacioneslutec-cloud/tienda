/* Envío del reporte por correo (opcional).
   Requiere dos variables de entorno en Netlify:
     RESEND_API_KEY  → clave de https://resend.com
     CORREO_ORIGEN   → remitente verificado, ej: tienda@tuempresa.com
   Si no las configuras, el aplicativo descarga el CSV y abre el correo. */

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Método no permitido', { status: 405 });
  }

  const clave = process.env.RESEND_API_KEY;
  const origen = process.env.CORREO_ORIGEN;
  if (!clave || !origen) {
    return new Response('Falta configurar RESEND_API_KEY y CORREO_ORIGEN en Netlify.', { status: 500 });
  }

  let datos;
  try {
    datos = await req.json();
  } catch {
    return new Response('Cuerpo inválido', { status: 400 });
  }

  const { para, asunto, cuerpo, csv, nombreArchivo } = datos;
  if (!para || !csv) {
    return new Response('Faltan el destinatario o el reporte', { status: 400 });
  }

  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clave}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: origen,
      to: [para],
      subject: asunto || 'Reporte de la tienda interna',
      text: cuerpo || 'Adjuntamos el reporte de pedidos.',
      attachments: [{
        filename: nombreArchivo || 'pedidos.csv',
        content: Buffer.from(csv, 'utf8').toString('base64')
      }]
    })
  });

  if (!respuesta.ok) {
    return new Response('El servicio de correo rechazó el envío: ' + (await respuesta.text()), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
