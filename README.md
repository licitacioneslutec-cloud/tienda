# Tienda interna — versión 2

Aplicativo para tableta: la persona entra con su identificación y una contraseña numérica, agrega productos con el lector de código de barras, con la cámara de la tableta, tocando la foto del producto o escribiendo su número corto, y elige entre pagar al momento o dejar el valor para descuento por nómina. El administrador configura productos con foto, verifica los pagos contra el soporte del banco y envía el reporte al correo de la empresa.

No necesita servidor ni base de datos: son archivos estáticos que se publican en Netlify.

---

## 1. Subir a GitHub

Sube estos archivos respetando las carpetas:

```
index.html
styles.css
app.js
netlify.toml
netlify/functions/enviar-reporte.js
README.md
```

Desde la web de GitHub: **Add file › Upload files**, arrastra todo y confirma con **Commit changes**.

## 2. Publicar en Netlify

1. netlify.com › **Add new site › Import an existing project**.
2. Conecta GitHub y elige el repositorio.
3. Deja el comando de compilación vacío; el directorio de publicación (`.`) ya viene en `netlify.toml`.
4. **Deploy**. Abre la dirección en la tableta y usa "Agregar a pantalla de inicio".

La cámara solo funciona sobre HTTPS, que es lo que entrega Netlify. Si pruebas en tu computador, ábrelo con `npx serve` en `localhost`, no con doble clic sobre el archivo.

## 3. Primer ingreso

| Identificación | Contraseña |
|---|---|
| `0000` | `1234` |

Cámbiala de inmediato en **Administración › Usuarios › Editar**.

## 4. Puesta en marcha

1. **Ajustes**: nombre del punto de venta, correo de la empresa, código corto de pago (Nequi, Daviplata, transferencia) e imagen del QR.
2. **Productos**: para cada uno defines
   - **Número corto**: el que usa la gente en el teclado numérico (agua = `01`). Si lo dejas vacío se asigna solo.
   - **Código de barras**: opcional, para el lector o la cámara.
   - **Foto**: elegida del dispositivo o tomada con la cámara. Se comprime a 640 px para que no llene la memoria.
   - Nombre, precio y categoría.

   También puedes importar un CSV con columnas `numero;codigo;nombre;precio;categoria`.
3. **Usuarios**: nombre, identificación y contraseña numérica de cada persona.

## 5. Cómo compra la gente

- **Lector de código de barras**: los lectores USB o Bluetooth funcionan como un teclado. El cursor se mantiene en la casilla del escáner, así que solo hay que pasar el producto.
- **Cámara de la tableta**: botón *Escanear con la cámara*. Usa el detector nativo del navegador y, donde no exista (iPad, Firefox), carga una librería de respaldo desde internet.
- **Número corto**: botón *Buscar por número* abre el teclado numérico en pantalla.
- **Foto del producto**: toca la tarjeta en la cuadrícula.

Cada persona ve su propio historial con el botón **Mis compras**: qué compró, cuánto lleva pendiente de nómina y qué pagos están sin verificar.

## 6. Verificación de pagos

Como las apps bancarias no devuelven un código que el aplicativo pueda comprobar, el flujo es este:

1. La persona paga con el QR o el código corto y toca **Ya pagué**. Puede escribir los últimos dígitos o la referencia, pero es opcional.
2. El pedido queda en estado **Aprobado, sin verificar**.
3. En **Administración › Verificar pagos** subes la captura o el PDF del movimiento bancario y contrastas contra la lista de pagos pendientes.
4. Por cada pedido decides: **Verificar** (queda como verificado) o **Pasar a nómina** (cambia a descuento de nómina y entra al resumen del mes).

Solo el administrador puede cambiar estos estados, y cada cambio queda registrado con el nombre de quien lo hizo.

## 7. Reporte al correo

En **Pedidos** filtras por fechas, método, estado o persona y pulsas **Enviar al correo de la empresa**. Por defecto se descarga el CSV y se abre el correo con el resumen para que lo adjuntes.

Para que se envíe solo, en Netlify › **Site settings › Environment variables** agrega:

- `RESEND_API_KEY` — clave gratuita de resend.com
- `CORREO_ORIGEN` — remitente verificado, por ejemplo `tienda@tuempresa.com`

Luego activa la casilla correspondiente en **Ajustes**.

---

## Lo que debes saber de esta versión

- **Los datos viven en la tableta.** Se guardan en el navegador del dispositivo. Si usas dos tabletas, cada una tendrá su propia información, y si alguien borra los datos del navegador se pierde todo. Descarga la copia de seguridad desde **Respaldo** al menos una vez por semana.
- **El espacio es limitado**, unos 5 MB. Las fotos de producto y los soportes bancarios son lo que más pesa; en Respaldo ves cuánto llevas ocupado y puedes borrar soportes viejos y pedidos ya cerrados.
- **Las contraseñas se guardan cifradas** con SHA-256 y una sal por usuario, pero al ser una app sin servidor cualquiera con acceso físico a la tableta puede leer el almacenamiento del navegador. Sirve para control interno, no para datos sensibles.
- **No hay control de inventario ni facturación electrónica.** Es un registro de consumo para conciliar con nómina.

## Siguiente versión

El salto natural es mover los datos a Supabase (plan gratuito): misma interfaz, pero con base compartida entre varias tabletas, respaldo automático, fotos y soportes sin límite de 5 MB, y reportes desde cualquier computador. La estructura de esta versión (`usuarios`, `productos`, `pedidos`, `soportes`) se traslada casi tal cual a tablas.
