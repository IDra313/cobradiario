# CobraDiario

Gestor de cobranza diaria con varios usuarios, reparto de rutas y reportes. App web (PWA) instalable en el teléfono.

## Características
- Login por usuario y contraseña (roles: admin y cobrador)
- Clasificación automática: al día / atrasado / zona roja
- Importación automática de archivos de texto/Word
- Ruta del día, búsqueda, navegación GPS (Waze/Maps) y recordatorios por WhatsApp
- Reportes por cobrador y control total (editar/eliminar/renovar)

## Usuarios por defecto
- Admin: `Erick` / `12345`
- Cobrador demo: `Carlos` / `12345`

## Ejecutar
```
node servidor.js
```
Luego abre http://localhost:8090

## Publicar (gratis)
Sube esta carpeta a un repositorio de GitHub y conéctala a Render:
- Build Command: *(vacío)*
- Start Command: `node servidor.js`
