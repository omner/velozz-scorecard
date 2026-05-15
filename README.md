# VELOZZ Scorecard Operativo

Portal web interno para visualización de desempeño semanal y bonos mensuales de conductores Amazon DSP para VELOZZ (estación DGD4).

**Versión actual:** v1.4.0 — Desempeño Semanal + Bono Mensual  
**URL del portal:** https://velozz-scorecard.web.app

---

## Arquitectura

```
Google Sheets (Excel fuente)
        │
        ▼
Google Apps Script (Code.gs)
        │  Lee datos, genera HTML, despliega
        ▼
Firebase Hosting (velozz-scorecard.web.app)
        │  Sirve el portal estático
        ▼
        Navegador del usuario
```

El portal es un **HTML estático de una sola página** generado completamente por Apps Script. No tiene backend propio — todos los datos quedan embebidos en el HTML al momento del deploy.

### Estructura del HTML generado

```
PREFIX (HTML + CSS + JS estático)
  └─ Autenticación, layout, tabs, estilos
DATA BLOCK (inyectado dinámicamente)
  └─ const ALL = [...];   // Conductores por semana
  └─ const DNR = {...};   // Registros DNR por semana
  └─ const __GENERATED__ = "fecha";
SUFFIX (JS dinámico)
  └─ var DSP_DATA = {...};    // Scorecard Amazon por semana
  └─ var BONUS_DATA = {...};  // Bono mensual por semana
  └─ buildDSP(), buildDNR(), buildBonusSection(), INIT
```

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `Code.gs` | Script principal — genera HTML, despliega a Firebase, corre semanalmente |
| `parseDSP.gs` | Parser de PDFs — procesa Scorecard DSP y Reportes de Bono desde Drive |
| `appsscript.json` | Manifiesto de Apps Script — permisos y servicios habilitados |
| `VERSION.json` | Metadatos de la versión actual y checksums para rollback |

---

## Setup inicial (una sola vez)

### 1. Google Sheets

El Excel fuente debe estar en Google Drive como Google Sheets con las siguientes hojas:

| Hoja | Descripción | Columnas clave |
|---|---|---|
| `SCORECARD VELOZZ` | Conductores activos por semana | [0] semana, [1] nombre, [2] transporter_id |
| `DATA_AMAZON` | Histórico de conductores Amazon | [0] semana, [1] nombre, [2] transporter_id |
| `VELOZZ DNR` | Registros de DNR por semana | — |

Copiar el **Spreadsheet ID** de la URL:
```
https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
```

### 2. Firebase

1. Ir a [console.firebase.google.com](https://console.firebase.google.com)
2. Crear proyecto: `velozz-scorecard`
3. Activar **Hosting** en el proyecto
4. Anotar el nombre del sitio (por defecto `velozz-scorecard`)

### 3. Google Cloud Console

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Seleccionar el proyecto asociado al Apps Script
3. **APIs & Services → Library** → habilitar:
   - **Google Drive API**
   - **Firebase Hosting API** (si no está habilitada)

### 4. Google Apps Script

1. Ir a [script.google.com](https://script.google.com) → **Nuevo proyecto**
2. Nombrar el proyecto: `VELOZZ Scorecard`
3. Crear los siguientes archivos en el editor:
   - `Code.gs` — pegar el contenido del archivo del repositorio
   - `parseDSP.gs` — pegar el contenido del archivo del repositorio
4. Click en **⚙️ Project Settings** → activar **"Show `appsscript.json` manifest file in editor"**
5. Reemplazar el contenido de `appsscript.json` con el del repositorio
6. En el panel izquierdo → **Services (+)** → agregar **Drive API v3**

### 5. Configuración en Code.gs

Actualizar el bloque `CONFIG` al inicio del archivo:

```javascript
const CONFIG = {
  SPREADSHEET_ID:  'TU_SPREADSHEET_ID',      // ID del Google Sheets
  FIREBASE_PROJECT: 'velozz-scorecard',       // Nombre del proyecto Firebase
  NOTIFY_EMAIL:    'tu@email.com',            // Email para notificaciones de deploy
  PASSWORD:        'VZLY0000',                // Contraseña del portal
  SESSION_MIN:     60,                        // Duración de sesión en minutos
};
```

Y el bloque `DSP_CONFIG` en `parseDSP.gs`:

```javascript
const DSP_CONFIG = {
  FOLDER_NAME:      'VELOZZ DSP Scorecards', // Nombre de la carpeta en Drive
  PROCESSED_FOLDER: 'Procesados',            // Subcarpeta para PDFs procesados
  SPREADSHEET_ID:   'TU_SPREADSHEET_ID',     // Mismo que CONFIG
};
```

### 6. Primera autorización

1. En Apps Script seleccionar función `buildAndDeploy`
2. Click **▶ Ejecutar**
3. Aceptar todos los permisos de Google (Drive, Sheets, Firebase, etc.)
4. Ejecutar de nuevo — el primer deploy puede tardar 30-60 segundos

### 7. Trigger automático semanal

Ejecutar la función `setupWeeklyTrigger` para configurar el deploy automático cada lunes a las 6am:

```
Apps Script → Ejecutar → setupWeeklyTrigger
```

### 8. Trigger automático para PDFs DSP (opcional)

Ejecutar `setupDSPTrigger` para que el script revise la carpeta de Drive cada hora:

```
Apps Script → Ejecutar → setupDSPTrigger
```

---

## Carpetas en Google Drive

Crear manualmente la siguiente estructura:

```
Mi unidad/
└─ VELOZZ DSP Scorecards/
   └─ Procesados/         ← se crea automáticamente
```

Los PDFs se suben a `VELOZZ DSP Scorecards/` y el script los mueve a `Procesados/` al terminar.

---

## Flujo de operación semanal

### Deploy automático (lunes 6am)
El trigger corre `buildAndDeploy()` automáticamente:
- Lee conductores y DNRs del Excel en Sheets
- Preserva `DSP_DATA` y `BONUS_DATA` existentes
- Genera nuevo HTML y despliega a Firebase
- Envía email de confirmación

### Nuevo Scorecard DSP (manual)
1. Descargar PDF de Amazon: `MX_VZLY_DGD4_WeekXX_YYYY_DSPScorecard.pdf`
2. Subir a la carpeta `VELOZZ DSP Scorecards` en Drive
3. En Apps Script ejecutar `parseDSPAndDeploy()`

El script detecta automáticamente si la semana ya fue procesada y la mueve a `Procesados` sin reprocesar.

### Nuevo Reporte de Bono Mensual (manual)
1. Descargar PDF de Amazon: `MX_VZLY_DGD4_WeekXX_YYYY_Bonus_Report.pdf`
2. Subir a la carpeta `VELOZZ DSP Scorecards` en Drive
3. En Apps Script ejecutar `parseDSPAndDeploy()`

> **Nota:** Solo se procesa la estación DGD4. Reportes de otras estaciones (XMX3, etc.) se mueven a `Procesados` automáticamente.

---

## Diagnóstico

Si `parseDSPAndDeploy()` falla con errores de Drive, ejecutar primero:

```
Apps Script → Ejecutar → diagnosticoDrive
```

Esto verifica paso a paso: carpeta en Drive → PDF encontrado → conversión PDF→Doc → extracción de texto.

---

## Rollback

Para restaurar una versión anterior:

1. Obtener el `Code.gs` de la versión deseada (del repositorio o del historial de GitHub)
2. En Apps Script reemplazar el contenido de `Code.gs` completo
3. Ejecutar `buildAndDeploy()`

Cada versión tiene checksums en el encabezado del `Code.gs` y en `VERSION.json` para verificar integridad:

```javascript
// VELOZZ Scorecard — v1.4.0 — 2025-05-15
// Prefix: dff8f2a0988a | Suffix: a554d17bf529
```

---

## Versiones

| Versión | Fecha | Descripción |
|---|---|---|
| v1.4.0 | 2025-05-15 | Desempeño Semanal + Bono Mensual, parser automático PDFs |
| v1.3.x | 2025-05 | DSP Scorecard como pestaña principal, zonas colapsables |
| v1.2.x | 2025-05 | Parser DSP Scorecard desde Drive |
| v1.1.x | 2025-05 | Tab DNR, deploy automático |
| v1.0.0 | 2025-04 | Primera versión funcional |

---

## Acceso al portal

| Contraseña | Rol | Acceso |
|---|---|---|
| `VZLY0000` | Staff | Todas las pestañas |
| `VZLYSTAFF` | Gerencia | Todas las pestañas |

---

## Pendientes v1.5.0

- [ ] Parser tabla DA en PDF S19 devuelve 0 conductores
- [ ] Estación XMX3 — sección separada para conductores
- [ ] Columna Sanciones — fuente de datos por definir
- [ ] `A29OH0L7MBQE9K` — sin nombre en Excel
- [ ] Identificación formal de helpers en el sistema
