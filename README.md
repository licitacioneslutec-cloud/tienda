# Tienda interna — versión 1

Aplicativo para tableta: la persona entra con su identificación, pasa los productos por el lector de código de barras y elige entre pagar al momento (QR o código corto) o dejar el valor para descuento por nómina. Un usuario administrador configura productos y precios, revisa lo comprado por cada persona y envía el reporte al correo de la empresa.

No necesita servidor ni base de datos: son archivos estáticos que se publican en Netlify.

---

## 1. Subir a GitHub

1. Crea un repositorio nuevo (por ejemplo `tienda-interna`).
2. Sube estos archivos tal como están, respetando las carpetas:

```
index.html
styles.css
app.js
netlify.toml
netlify/functions/enviar-reporte.js
README.md
```

Si prefieres la web de GitHub: **Add file › Upload files**, arrastra todo y confirma con **Commit changes**.

## 2. Publicar en Netlify

1. Entra a netlify.com › **Add new site › Import an existing project**.
2. Conecta GitHub y elige el repositorio.
3. Deja el comando de compilación vacío y el directorio de publicación en `.` (ya viene en `netlify.toml`).
4. **Deploy**. En un minuto tienes la dirección, por ejemplo `https://tienda-interna.netlify.app`.
5. En la tableta abre esa dirección y usa "Agregar a pantalla de inicio" para que se vea como una app.

## 3. Primer ingreso

| Identificación | Contraseña |
|---|---|
| `0000` | `admin123` |

Cambia esa contraseña de inmediato en **Administración › Usuarios › Editar**.

## 4. Puesta en marcha

1. **Ajustes**: nombre del punto de venta, correo de la empresa, código corto de pago (Nequi, Daviplata, transferencia) e imagen del QR.
2. **Productos**: agrégalos uno a uno o importa un CSV con columnas `codigo,nombre,precio,categoria`. El campo *código* debe ser exactamente el que imprime el lector.
3. **Usuarios**: crea a cada persona con su nombre, identificación y contraseña.

## 5. El lector de código de barras

Los lectores USB o Bluetooth funcionan como un teclado: escriben el código y pulsan Enter. La pantalla de compra mantiene el cursor en la casilla del escáner, así que solo hay que pasar el producto. También puedes escribir el código a mano y pulsar Enter, o usar los botones de acceso rápido.

## 6. Reporte al correo

En **Pedidos** filtras por fechas, método o persona y pulsas **Enviar al correo de la empresa**. Por defecto se descarga el CSV y se abre el correo con el resumen para que lo adjuntes.

Para que se envíe solo, en Netlify › **Site settings › Environment variables** agrega:

- `RESEND_API_KEY` — clave gratuita de resend.com
- `CORREO_ORIGEN` — remitente verificado, por ejemplo `tienda@tuempresa.com`

Luego activa la casilla correspondiente en **Ajustes**.

---

## Lo que debes saber de esta versión

- **Los datos viven en la tableta.** Se guardan en el navegador del dispositivo. Si se usan dos tabletas, cada una tendrá su propia información, y si alguien borra los datos del navegador se pierde todo. Descarga la copia de seguridad desde **Respaldo** al menos una vez por semana.
- **Las contraseñas se guardan cifradas** con SHA-256 y una sal por usuario, pero al ser una app sin servidor cualquiera con acceso físico a la tableta puede leer el almacenamiento del navegador. Sirve para control interno, no para datos sensibles.
- **No hay control de inventario ni facturación electrónica.** Es un registro de consumo para conciliar con nómina.

## Siguiente versión

Cuando esta versión ya esté en uso, el salto natural es mover los datos a Supabase (plan gratuito): misma interfaz, pero con inicio de sesión real, base de datos compartida entre varias tabletas, respaldo automático y reportes desde cualquier computador. La estructura de datos de esta versión (`usuarios`, `productos`, `pedidos`) se traslada casi tal cual a tablas.
