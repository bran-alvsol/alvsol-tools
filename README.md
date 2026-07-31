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
├── index.html
├── 404.html
├── .nojekyll
├── assets/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js
│       ├── firebase-config.js
│       ├── firebase-service.js
│       └── tool-guard.js
├── docs/
│   └── firestore.rules
└── tools/
    ├── demo-tool/
    │   ├── index.html
    │   ├── script.js
    │   └── styles.css
    └── herramienta-compras/
        ├── index.html
        └── LEEME_V5_21.txt
```

## Herramientas disponibles

- **HERRAMIENTA COMPRAS:** compras, transferencias y catálogo BOX, versión 5.21.
- **Herramienta demo:** ejemplo usado para comprobar la estructura del portal.

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

## Agregar una herramienta nueva

1. Crea una carpeta dentro de `tools/`, por ejemplo `tools/nueva-herramienta/`.
2. Coloca ahí su `index.html`, CSS, JS y archivos propios.
3. Agrega una entrada en el arreglo `tools` de `assets/js/app.js`.
4. Prueba desde el dashboard.

## Notas de mantenimiento

- No mezcles código de herramientas dentro del portal.
- El portal solo debe enlazar y coordinar acceso.
- `tool-guard.js` devuelve al login a quien intente abrir directamente una herramienta sin una sesión autorizada.
- Las pruebas de Firestore usan la colección `portal_test_records`.
- Las herramientas reales deben migrarse una por una.
