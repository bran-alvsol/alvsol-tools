# ALVSOL Tools Windows

Primera versión del programa local para reunir las herramientas de ALVSOL S.A. y BOX Protección Celular.

## Estado de esta fase

- Panel de escritorio independiente de Chrome.
- Base de datos local dentro del perfil de Windows.
- Respaldos automáticos y manuales.
- Carpeta adicional de respaldo configurable.
- Intercambio de copias mediante una carpeta compartida.
- Detección de conflictos entre dos computadoras.
- Instalación de herramientas mediante HTML o ZIP.
- Analizador de Metas conectado a la base local del programa.
- Compras, Presupuesto y Cuadre disponibles en modo de compatibilidad mientras se migra su guardado.

## Datos locales

El programa utiliza esta carpeta de Windows:

`%APPDATA%\alvsol-tools-desktop`

La desinstalación no elimina esa información. Los respaldos locales se conservan dentro de la subcarpeta `backups`.

## Desarrollo

```powershell
cd desktop
npm install
npm start
```

## Crear instalador

```powershell
cd desktop
npm run dist
```

El instalador se genera en `desktop\dist`.

## Sincronización

La base activa nunca se abre directamente desde OneDrive. El programa crea copias cerradas, numeradas y verificadas dentro de la carpeta compartida. Si dos computadoras parten de versiones diferentes, el programa informa un conflicto y no reemplaza datos automáticamente.

Pasos sencillos:

1. Crea una carpeta de OneDrive accesible desde las dos computadoras.
2. En cada computadora abre `Sincronización` y selecciona esa misma carpeta.
3. Antes de cambiar de computadora, pulsa `Compartir copia actual`.
4. En la otra computadora, pulsa `Revisar cambios` y luego `Aplicar copia disponible`.

La carpeta compartida transporta copias de los datos; no es la base principal. Las herramientas nuevas o actualizadas se instalan una vez en cada computadora usando el mismo HTML o ZIP.

## Actualizar herramientas

Abre `Actualizaciones`, selecciona el HTML o ZIP, revisa el nombre y la versión y pulsa `Instalar actualización`. El programa conserva una copia de la versión anterior antes de reemplazarla.

Para pedir cambios en los chats donde se desarrolla cada herramienta, utiliza el texto de `PROMPT-PARA-ACTUALIZAR-HERRAMIENTAS.txt`.
