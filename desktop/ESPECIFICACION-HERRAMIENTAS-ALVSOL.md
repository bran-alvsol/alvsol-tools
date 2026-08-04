# Formato de herramientas para ALVSOL Tools Windows

## Entrega

La herramienta debe entregarse como uno de estos formatos:

- Un archivo HTML único.
- Un ZIP con `index.html` y todos sus recursos.

El nombre debe incluir la versión, por ejemplo:

`Herramienta_Gastos_Bodega_V2_1.zip`

## Reglas obligatorias

1. Debe funcionar sin internet.
2. No debe cargar librerías, fuentes o imágenes desde internet.
3. Cada herramienta debe tener un identificador permanente, por ejemplo `herramienta-gastos-bodega`.
4. La versión debe aparecer en el título y dentro de la pantalla.
5. Debe conservar compatibilidad con el navegador durante la transición.
6. Dentro de ALVSOL Tools Windows debe usar `window.alvsolDesktop.storage` cuando esté disponible.
7. El estado principal debe poder convertirse a JSON.
8. Debe incluir exportación y restauración manual de respaldo.
9. Una actualización debe poder leer los datos creados por la versión anterior.
10. No debe borrar información sin confirmación y sin recomendar un respaldo.

## Guardado dentro del programa

La herramienta debe usar una clave estable para su estado principal:

```javascript
const STORAGE_KEY = "estado-principal";

async function readState() {
  if (window.alvsolDesktop?.storage) {
    const stored = await window.alvsolDesktop.storage.getJson(STORAGE_KEY);
    return stored?.valueJson ? JSON.parse(stored.valueJson) : null;
  }
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
}

async function writeState(value) {
  if (window.alvsolDesktop?.storage) {
    await window.alvsolDesktop.storage.setJson(STORAGE_KEY, JSON.stringify(value));
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
```

Los archivos grandes deben tratarse por separado en una adaptación posterior. No deben convertirse a cadenas enormes sin revisar primero su tamaño.

## Revisión antes de instalar

- Abrir la herramienta sin internet.
- Guardar información y cerrar completamente.
- Abrir de nuevo y confirmar la recuperación.
- Crear un respaldo.
- Instalar la nueva versión y comprobar los datos anteriores.
- Confirmar que no existen enlaces externos obligatorios.
