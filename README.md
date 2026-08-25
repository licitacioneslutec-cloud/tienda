# Tienda interna — versión 4 (Firebase)

Punto de venta interno. Cada persona entra desde su celular con su cédula y una clave de 4 dígitos, arma su pedido y confirma. Todo se cobra por **descuento de nómina**. Los datos viven en Firebase Realtime Database, así que todos los teléfonos ven lo mismo al instante: si alguien se lleva el último café, a los demás les aparece agotado.

---

## Archivos del repositorio

```
index.html
styles.css
app.js
firebase-config.js
manifest.json
sw.js
netlify.toml
iconos/            (4 archivos png)
firebase/          (no se publica: reglas y carga inicial)
n8n/               (no se publica: el flujo de correo)
```

---

## Paso 1 · Activar el acceso anónimo en Firebase

Sin esto la aplicación no puede leer nada.

1. Consola de Firebase › **Authentication** › Comenzar.
2. Pestaña **Sign-in method** › **Anónimo** › Habilitar › Guardar.

No le pide nada a la gente: la aplicación se identifica sola en segundo plano. Sirve para que las reglas puedan exigir que quien lee sea alguien que abrió la página, y no un rastreador automático.

## Paso 2 · Cargar el personal

1. Consola › **Realtime Database** › pestaña **Datos**.
2. Menú de tres puntos (arriba a la derecha del nodo raíz) › **Importar JSON**.
3. Elige `firebase/usuarios-inicial.json`.

Quedan cargadas 62 personas: las 61 del archivo de nómina más el usuario `0000`. La clave de cada quien son **los últimos 4 dígitos de su cédula**, y a todos se les pide cambiarla al entrar. El archivo `firebase/claves-iniciales.csv` es la lista para repartir.

⚠️ Importar en la raíz **reemplaza toda la base**. Hazlo antes que nada.

## Paso 3 · Publicar las reglas

1. Consola › Realtime Database › pestaña **Reglas**.
2. Borra lo que haya y pega el contenido de `firebase/database.rules.json`.
3. **Publicar**.

Si no haces esto, Firebase deja la base abierta a todo internet y te manda correos de advertencia.

## Paso 4 · Subir el sitio a GitHub y publicarlo en Netlify

Sube los archivos respetando las carpetas. Netlify reconstruye solo; no hay comando de compilación.

Antes de subir, abre `firebase-config.js` y compara los valores con los de tu consola (Configuración del proyecto › Tus aplicaciones › lutectienda › Config). Los copié de una captura de pantalla, así que vale la pena verificar carácter por carácter, sobre todo el `apiKey`.

## Paso 5 · Entrar como administrador

Cédula `0000`, clave `1234`. Te pedirá cambiarla enseguida.

En **Ajustes** pon el nombre de la tienda, el correo que recibe los reportes, y la URL y el token de n8n si ya tienes el flujo montado.

En **Productos** carga lo que vendes: número corto, nombre, precio, foto y existencias iniciales.

## Paso 6 · Repartir a la gente

Cada persona abre la dirección del sitio en su celular y la instala:

- **Android / Chrome**: menú de tres puntos › *Instalar aplicación*.
- **iPhone / Safari**: botón Compartir › *Añadir a pantalla de inicio*. Tiene que ser Safari.

Entra con su cédula y los últimos 4 dígitos de la misma, define su clave, y ya puede comprar.

---

## Cómo funciona el día a día

**Para la gente.** Abre la app, busca el producto por nombre, toca su foto, o lo escanea con la cámara, y confirma. Ve lo que lleva pendiente de descuento en *Mis compras*.

**Para el administrador.** La pestaña Administración solo la ve quien tenga rol de admin. Ahí están productos, inventario, usuarios, pedidos y reportes.

**Inventario.** Cada venta descuenta unidades. Si dos personas compran el último producto al mismo tiempo, la base resuelve el conflicto y una de las dos recibe el aviso de que se agotó; nadie queda con el conteo torcido.

**Reportes.** Filtras por fecha, estado o persona, y eliges entre el detallado (qué pidió cada quien) y el resumen (total por persona, incluyendo a quienes no compraron nada). Los dos salen en Excel y PDF, o se envían por correo a través de n8n.

**Si alguien olvida su clave.** El administrador entra a Usuarios y pulsa *Reiniciar clave*: vuelve a los últimos 4 dígitos de la cédula y se le pide cambiarla. No hace falta correo.

---

## Lo que debes tener claro

**Cualquiera que abra el sitio puede leer la base.** Elegiste login propio con reglas abiertas a quien esté autenticado, y la autenticación es anónima, así que basta con abrir la página para obtener acceso de lectura. Un empleado con curiosidad y conocimientos podría ver las 61 cédulas y el consumo de todos. Las reglas frenan a los rastreadores automáticos que buscan bases de Firebase sueltas, que es la amenaza más común, pero no a alguien de adentro. No pongas ahí nada más sensible que esto.

**Las claves sí están protegidas.** Se guardan cifradas con SHA-256 y una sal distinta por persona. Ni yo ni nadie puede leerlas desde la base.

**Hace falta internet.** A diferencia de la versión de la tableta, ahora los datos están en la nube. Sin señal, la app abre pero no deja comprar.

**El plan gratuito alcanza de sobra.** Con 61 personas y un consumo normal, el gasto de datos queda muy por debajo del límite. Las fotos de producto son lo que más pesa, por eso se comprimen a 480 píxeles y se guardan aparte, para que la lista cargue rápido en el celular.

**El escaneo con cámara depende del teléfono.** En Android funciona de forma nativa. En iPhone se apoya en una librería externa y es más lento; por eso el número corto y la búsqueda por nombre siguen siendo el camino principal.

---

## Siguiente mejora, cuando quieras

Pasar a Firebase Authentication con cuentas reales. La persona seguiría escribiendo 4 dígitos, pero por dentro el aplicativo les añadiría un sufijo fijo para cumplir el mínimo de 6 caracteres de Firebase. Con eso las reglas podrían decir "cada quien solo lee sus propios pedidos" y la lista de personal quedaría reservada al administrador. Es la única forma de cerrar del todo el punto de la lectura abierta.
