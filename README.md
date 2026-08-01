# ALVSOL Tools

Portal web interno y estático para centralizar herramientas HTML de ALVSOL S.A. / BOX Protección Celular.

## Portal publicado

- Sitio: https://bran-alvsol.github.io/alvsol-tools/
- Código: https://github.com/bran-alvsol/alvsol-tools

El sitio está alojado gratuitamente en GitHub Pages. Firebase controla el inicio de sesión y las herramientas devuelven al portal a quien intente abrirlas directamente sin una sesión autorizada.

## Objetivo

- Mantener un portal principal con login y dashboard.
- Conservar cada herramienta HTML separada dentro de `tools/`.
- Usar Firebase Auth y Firestore en plan gratuito.
- Publicar sin backend propio, idealmente con GitHub Pages.
- Avanzar por fases sin migrar todas las herramientas de una vez.

## Estructura

```text
.
|-- index.html
|-- 404.html
|-- ABRIR-ALVSOL-TOOLS.bat
|-- GESTIONAR-HERRAMIENTAS.bat
|-- ACTUALIZAR-ALVSOL-TOOLS.bat
|-- PUBLICAR-ALVSOL-TOOLS.bat
|-- COMO-ACTUALIZAR.txt
|-- ACTUALIZACIONES/
|   |-- PENDIENTES/
|   `-- PROCESADAS/
|-- assets/
|   |-- css/
|   |-- data/
|   |   `-- tools.json
|   `-- js/
|-- docs/
|-- scripts/
`-- tools/
    |-- herramienta-compras/
    `-- herramienta-presupuesto/
```

## Herramientas disponibles

- **HERRAMIENTA COMPRAS:** compras, transferencias y catálogo BOX, versión 5.21.
- **HERRAMIENTA PRESUPUESTO:** control y planificación del presupuesto de compras ALVSOL, versión 1.4.

## Configurar Firebase

1. Crea un proyecto en Firebase.
2. Agrega una app Web.
3. Activa Authentication con el proveedor Email/Password.
4. Crea una base Cloud Firestore.
5. Copia la configuración web del proyecto en `assets/js/firebase-config.js`.
6. En Firestore Rules, pega el contenido de `docs/firestore.rules` y publica las reglas.

## Crear la cuenta administradora

1. En Firebase abre Authentication > Usuarios.
2. Agrega una cuenta con la dirección interna `admin@alvsol.local`.
3. Asigna una contraseña segura que solo conozca el administrador.
4. En el portal inicia sesión con el usuario `admin` y esa contraseña.
5. Usa la sección `Administrar usuarios` para crear las demás cuentas.

Los empleados entran con usuario y contraseña. No necesitan un correo real. Firebase recibe una dirección interna terminada en `@alvsol.local`, pero el portal nunca la muestra.

El archivo `firebase-config.js` debe quedar parecido a esto:

```js
export const firebaseConfig = {
  apiKey: "tu-api-key",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## Probar localmente

### Forma sencilla en Windows

Haz doble clic en `ABRIR-ALVSOL-TOOLS.bat`. El archivo enciende el servidor local y abre el portal en el navegador.

Si la computadora se reinicia, vuelve a ejecutar el archivo antes de entrar a `http://localhost:8000`.

### Forma manual

Desde la carpeta del proyecto:

```powershell
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

No abras `index.html` directo con doble clic para probar Firebase, porque los módulos ES funcionan mejor servidos por HTTP.

## Publicar en GitHub Pages

1. Sube esta carpeta a un repositorio de GitHub.
2. En GitHub, entra a Settings > Pages.
3. En Source selecciona Deploy from a branch.
4. Elige la rama principal y la carpeta `/root`.
5. Guarda y espera la URL pública de GitHub Pages.

Si usas un dominio de GitHub Pages, agrega ese dominio en Firebase Authentication > Settings > Authorized domains.

En este proyecto ya está autorizado el dominio `bran-alvsol.github.io`.

## Publicar cambios futuros

Después de modificar y probar el portal, ejecuta desde esta carpeta:

```powershell
git add .
git commit -m "Descripción breve del cambio"
git push
```

GitHub Pages publicará automáticamente la nueva versión unos minutos después.

## Agregar o actualizar herramientas

El administrador guiado sirve para agregar herramientas nuevas y actualizar cualquiera de las existentes. Cada herramienta conserva su propia carpeta dentro de `tools/`.

### Paso 1: colocar el ZIP

1. Abre la carpeta `ACTUALIZACIONES/PENDIENTES/`.
2. Coloca allí el ZIP de la nueva versión.
3. Deja solamente un ZIP en esa carpeta.
4. Procura que el nombre incluya la versión, por ejemplo `Herramienta_Presupuesto_V1_5.zip`.

### Paso 2: elegir la acción

Haz doble clic en `GESTIONAR-HERRAMIENTAS.bat`. También puedes seguir usando `ACTUALIZAR-ALVSOL-TOOLS.bat`, que abre el mismo asistente.

La ventana mostrará una lista parecida a esta:

```text
0. Agregar una herramienta nueva
1. Actualizar HERRAMIENTA COMPRAS
2. Actualizar HERRAMIENTA PRESUPUESTO
```

Para agregar una herramienta, elige `0` y escribe el nombre y una descripción corta. Para actualizar, escribe el número de la herramienta correspondiente.

El sistema revisará el ZIP, detectará la versión, preparará su carpeta y abrirá el portal local. Cuando se trate de una actualización, guardará antes un respaldo de la versión actual. Si algo no es válido, se detendrá sin borrar la herramienta que ya funciona.

### Paso 3: probar

Inicia sesión en el portal local y abre la herramienta preparada. Antes de publicar, comprueba con archivos reales:

- Carga de reportes.
- Análisis y cálculos.
- Exportaciones y descargas.
- Botón para volver al portal.

### Paso 4: publicar

Cuando todo funcione, haz doble clic en `PUBLICAR-ALVSOL-TOOLS.bat`. Escribe `PUBLICAR` cuando la ventana lo solicite.

La actualización se enviará a GitHub. GitHub Pages puede tardar unos minutos en mostrarla. Después abre el portal publicado y presiona `Ctrl + F5` para cargar la versión nueva.

### Respaldos

El ZIP utilizado y una copia de la versión anterior quedan en `ACTUALIZACIONES/PROCESADAS/`. Esos ZIP no se suben al sitio público. Git también conserva el historial de las versiones publicadas.

No borres ni renombres las carpetas dentro de `tools/`. El administrador se encarga de mantener el nombre correcto, añadir la protección de acceso y actualizar automáticamente la lista del dashboard guardada en `assets/data/tools.json`.

Las herramientas deben ser páginas web estáticas que funcionen con HTML, CSS y JavaScript. Los archivos que necesitan un servidor propio no pueden ejecutarse en GitHub Pages.

## Notas de mantenimiento

- No mezcles código de herramientas dentro del portal.
- El portal solo debe enlazar y coordinar acceso.
- `tool-guard.js` devuelve al login a quien intente abrir directamente una herramienta sin una sesión autorizada.
- Las pruebas de Firestore usan la colección `portal_test_records`.
- Las herramientas reales deben migrarse una por una.
