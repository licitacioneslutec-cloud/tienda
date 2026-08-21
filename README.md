# Tienda interna — versión 3

Aplicativo para tableta. La persona entra con su identificación y una contraseña numérica, agrega productos con el lector de código de barras, con la cámara, tocando la foto o escribiendo el número corto, y confirma el pedido. **Todo se cobra por descuento de nómina**: no hay pagos con QR ni verificación de transferencias.

El administrador configura productos y usuarios, marca los pedidos como descontados y saca los reportes en Excel y PDF, tanto detallados como resumidos. El envío de correos lo hace un flujo de n8n de la empresa, no el aplicativo.

Son archivos estáticos: se publican en Netlify sin comando de compilación.

---

## 1. Archivos

```
index.html
styles.css
app.js
netlify.toml
n8n/flujo-tienda.json
README.md
```

La carpeta `n8n` no se publica: es solo el flujo para importar en tu servidor.

Ya no hay carpeta `netlify/functions`. Si venías de la versión anterior, **bórrala del repositorio** junto con las variables de entorno de Resend.

## 2. Publicar

netlify.com › **Add new site › Import an existing project** › elige el repositorio › Deploy. Directorio de publicación `.`, sin comando de compilación. Abre la dirección en la tableta y usa "Agregar a pantalla de inicio".

La cámara solo funciona sobre HTTPS. Para probar en el computador usa `npx serve` sobre `localhost`, no abras el archivo con doble clic.

## 3. Primer ingreso

Identificación `0000`, contraseña `1234`. Al entrar te pedirá cambiar la contraseña y te mostrará el **código de recuperación** de 12 dígitos del administrador. Anótalo: es lo único que permite volver a entrar si se olvida la contraseña.

## 4. Alta de usuarios

En **Usuarios**, cada persona necesita nombre, identificación y correo. La contraseña viene precargada con la **genérica** que definas en Ajustes (`1234` por defecto) y la casilla *Pedirle que cambie la contraseña la primera vez que entre* está marcada.

Cuando la persona ingresa con la genérica:

1. El aplicativo abre un modal que no se puede cerrar hasta que defina su propia contraseña. No acepta que sea igual a la genérica.
2. Enseguida le muestra **Mi cuenta** para que confirme su correo. Ahí puede corregirlo y pulsar **Enviarme un correo de prueba** para comprobar que llega de verdad.

Después puede volver a **Mi cuenta** cuando quiera, desde la barra superior, para revisar el correo o cambiar la contraseña.

Para cargar mucha gente de una vez, **Importar CSV** en Usuarios acepta columnas `identificacion;nombre;correo`. Todos entran con la contraseña genérica y con el cambio obligatorio activado.

## 5. Recuperación de contraseña

En la pantalla de ingreso, **Olvidé mi contraseña** pide la identificación y envía un código de 6 dígitos al correo registrado. Vence en 15 minutos, sirve una vez y admite cinco intentos. En la misma casilla, los administradores pueden usar su código de 12 dígitos.

El código se valida contra la tableta, porque allí vive la base de datos: hay que pedirlo y escribirlo **en la misma tableta**.

## 6. Inventario

Cada producto tiene **existencias**, un nivel de aviso (*avisar cuando queden*) y la opción de **no dejar venderlo cuando llegue a cero**.

- Al confirmar un pedido, el aplicativo descuenta las unidades y deja registrado el movimiento.
- En la tienda, los productos por acabarse muestran *Quedan N* sobre la foto; los agotados salen en gris y no se pueden agregar si tienen el bloqueo activo.
- Al entrar a Administración aparece un aviso si hay algo agotado o por acabarse.

En la pestaña **Inventario** ves el total de unidades, el valor de la mercancía, cuántos productos están por acabarse y cuántos agotados. Desde ahí registras:

- **Entrada**: llegó mercancía, suma unidades.
- **Ajuste**: después de un conteo físico, deja el producto en la cantidad exacta que escribas.
- **Baja**: se dañó o se perdió, resta unidades.

Todo queda en la tabla de movimientos con fecha, cantidad, saldo, motivo y quién lo hizo. Se guardan los últimos 500 y se pueden descargar en Excel.

El inventario también se descarga en Excel y PDF, o se envía al correo con los dos adjuntos. Ese envío incluye además la lista de lo que hay que reponer.

Si vienes de una versión anterior, los productos existentes quedan en cero unidades y **sin bloqueo**, para que nada deje de venderse de un día para otro. A medida que cuentes cada producto, usa *Ajuste* y activa el bloqueo en su ficha.

Para cargar existencias en masa, el CSV de productos ahora acepta las columnas `existencias` y `minimo`.

## 7. Reportes

En **Pedidos y reportes** filtras por fechas, estado o persona, y eliges el contenido:

- **Detallado**: una fila por producto, con identificación, nombre, pedido, fecha, producto, cantidad, precio, subtotal y estado. Ordenado por persona.
- **Resumen**: una fila por persona con el total y lo pendiente de descuento. **Incluye a todos los usuarios activos aunque no hayan pedido nada**, ordenados de mayor a menor consumo, de modo que quienes compraron quedan arriba y los de cero al final en orden alfabético.

Con cada uno puedes **Descargar Excel** (CSV con separador `;` y BOM, se abre directo en Excel), **Descargar PDF** o **Enviar al correo**, que manda ambos archivos adjuntos al correo configurado.

## 8. El flujo de n8n

El aplicativo no envía correos: hace un POST con JSON a tu webhook y tu flujo se encarga del envío desde `proyectos@lutec.com.co`. No hay funciones de Netlify ni servicios de terceros de por medio.

### Montarlo

1. En n8n: **Workflows › Import from File** y elige `n8n/flujo-tienda.json`.
2. Abre el nodo **Webhook de la tienda** y en *Options › Allowed Origins (CORS)* reemplaza el valor por la dirección exacta de tu sitio, por ejemplo `https://tienda-lutec.netlify.app`. Sin esto el navegador rechaza la respuesta aunque el flujo se ejecute bien.
3. Abre **Validar y preparar** y cambia las tres primeras líneas: el `TOKEN`, el `DOMINIO` y el máximo de correos por dirección por hora.
4. Abre **Enviar correo**, conecta las credenciales SMTP de `proyectos@lutec.com.co` y confirma el remitente.
5. Activa el flujo y copia la **URL de producción** del webhook.
6. En la tableta, **Ajustes**: pega esa URL, escribe el mismo token y pulsa **Enviar un correo de prueba**.

### Qué hace el flujo

Rechaza la petición si el token no coincide, si el destinatario no es del dominio de la empresa o si esa dirección ya recibió demasiados correos en la última hora. Después arma el mensaje según el tipo, convierte los adjuntos de base64 a archivos y responde a la tableta.

### Los mensajes que envía la tableta

Todos traen `empresa`, `generado` y `tipo`.

**`codigo`** — recuperación de contraseña
```json
{ "tipo":"codigo", "para":"persona@lutec.com.co", "nombre":"Nombre Apellido",
  "codigo":"483920", "vigenciaMinutos":15 }
```

**`prueba`** — comprobar que el correo llega
```json
{ "tipo":"prueba", "para":"persona@lutec.com.co", "nombre":"Nombre Apellido" }
```

**`reporte`** — consumo del período
```json
{ "tipo":"reporte", "para":"nomina@lutec.com.co",
  "asunto":"Resumen de consumo por persona · ...",
  "resumen":"texto plano con los totales",
  "periodo":"Del 2026-08-01 al 2026-08-15",
  "totales":{ "pedidos":42, "total":186000, "pendiente":94000 },
  "adjuntos":[
    { "nombre":"resumen_tienda.csv", "tipo":"text/csv", "contenidoBase64":"..." },
    { "nombre":"resumen_tienda.pdf", "tipo":"application/pdf", "contenidoBase64":"..." }
  ] }
```

**`inventario`** — corte de existencias, igual que el anterior más `porReponer`, un arreglo con los productos agotados o por acabarse.

### Seguridad de un webhook público

La URL y el token quedan guardados en la tableta, así que quien tenga el dispositivo en la mano puede leerlos. Como la tableta no se mueve del sitio, la defensa más efectiva es **restringir el webhook a la IP pública de la oficina**, en el proxy que tengas delante de n8n (nginx, Traefik, Cloudflare). Con eso, un token filtrado no sirve desde afuera. Requiere que la oficina tenga IP fija; si es dinámica, sirve igual un rango o un DNS dinámico.

Sin ese filtro, el peor caso realista es que alguien mande códigos o reportes a buzones del dominio de la empresa: molesto, pero no da acceso a ninguna cuenta, porque el código se valida contra la tableta. El token, el filtro de dominio y el límite por hora que trae el flujo ya cubren ese escenario.

Cambia el token cuando rote el personal con acceso al kiosco: se cambia en el nodo Code y en Ajustes, y listo.

## 9. Lo que debes saber

- **Los datos viven en la tableta**, en el almacenamiento del navegador. Dos tabletas son dos bases separadas. Descarga la copia desde **Respaldo** al menos una vez por semana.
- **El espacio es de unos 5 MB.** Las fotos de producto se comprimen a 640 px; en Respaldo ves cuánto llevas ocupado y puedes borrar pedidos ya descontados.
- **Las contraseñas y los códigos se guardan cifrados** con SHA-256 y sal por usuario, pero quien tenga la tableta puede leer el almacenamiento del navegador. Sirve para control interno.
- **El token del webhook queda guardado en la tableta.** Trátalo como una llave de la casa, no como un secreto fuerte.
- **El PDF se genera en el navegador** con jsPDF cargado desde una CDN. Sin internet no hay PDF; el Excel sí funciona sin conexión.

## 10. Siguiente paso

Con muchos usuarios, dos cosas van a apretar: el límite de 5 MB y el hecho de que cada tableta sea una isla. Mover los datos a Supabase resuelve ambas, permite consultar los reportes desde cualquier computador y hace que la recuperación por correo funcione desde cualquier dispositivo. La estructura actual (`usuarios`, `productos`, `pedidos`) se traslada casi tal cual a tablas.
