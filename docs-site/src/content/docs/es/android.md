---
title: "Android"
description: "Dispositivos, emuladores, apps, permisos y automatización mediante el agente nativo."
sidebar:
  order: 4
---
El driver de Android de Astur usa herramientas públicas de Android para el ciclo de vida y los artefactos:

- `adb devices -l` para el descubrimiento
- `adb install -r` para la instalación
- `monkey` o `am start` para el arranque
- `uiautomator dump` para instantáneas heredadas de la interfaz y diagnósticos
- `input tap`, `input text`, `input swipe` e `input keyevent` solo para el camino alternativo heredado
- `screencap` para las capturas
- `aapt dump badging` para deducir paquete y actividad del APK cuando está disponible

No hace falta ningún servidor Appium.

Astur usa por defecto el camino con agente nativo UIAutomator en Kotlin para buscar elementos, esperar, ejecutar acciones y gestos. El paquete publicado de Android incluye los APK del agente, así que una instalación normal desde npm no requiere compilarlo aparte. Usa `automation.engine: 'auto'` solo durante una migración, si necesitas volver al antiguo camino de ADB/XML.

## Astur en acción sobre Android

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">DEMOSTRACIÓN EN ANDROID</span>
    <strong>Mira a Astur ejecutar un flujo completo en Android.</strong>
    <p>Descubrimiento, interacción y ejecución de tests nativos funcionando juntos contra una app real.</p>
    <a class="astur-video-link" href="https://youtu.be/ByVb8MeA6kM" target="_blank" rel="noreferrer">Ver en YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/ByVb8MeA6kM" title="Demostración de automatización de Astur en Android" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

## Instalar el Android SDK

Instala Android Studio o el Android SDK de línea de comandos. Asegúrate de tener disponibles las platform tools:

```bash
adb version
```

Si no encuentra `adb`, añade las platform tools al `PATH`.

Ejemplo en macOS:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## Arrancar un emulador

Usa el Device Manager de Android Studio o la línea de comandos:

```bash
emulator -list-avds
emulator -avd Pixel_8_API_35
```

Después comprueba:

```bash
adb devices -l
npx astur-mobile devices --android
```

## Dispositivo Android real

En el dispositivo:

- activa las Opciones de desarrollador
- activa la depuración USB
- conéctalo por USB
- acepta el aviso de depuración

Comprueba:

```bash
adb devices -l
```

El estado debe ser `device`. Si aparece `unauthorized`, desbloquea el dispositivo y acepta el aviso.

## Configuración de Android

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'android',
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true,
        bootTimeout: 120_000
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

### Endpoint opcional del agente nativo

```ts
agent: {
  mode: 'auto',
  endpoint: 'tcp:127.0.0.1:8787',
  launchTimeout: 15_000,
  commandTimeout: 10_000
}
```

Sobrescritura por entorno:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
```

Usa `agent.mode: 'required'` en CI en cuanto el conjunto de comandos del agente nativo de Android sea estable para tu suite.

Por defecto, Astur arranca una sesión de agente nativo de Android por worker de Playwright. No reinstala el agente antes de cada spec: los APK incluidos se instalan solo cuando falta la app del agente o el paquete de tests. Define `ASTUR_ANDROID_AGENT_FORCE_INSTALL=1` cuando estés desarrollando el agente y quieras refrescar los APK del dispositivo a propósito.

Con `device.avd`, Astur arranca el emulador si no encuentra ninguno en línea que encaje. Con `app.path`, Astur instala el APK antes de que empiece el test. Cuando `aapt` está disponible en el Android SDK, Astur también deduce `packageName` y la `activity` de arranque.

Puedes seguir dejándolo todo explícito:

```ts
device: {
  id: 'emulator-5554'
},
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

Usa un `device.id` concreto para ejecuciones en paralelo. Los selectores poco específicos como `{ kind: 'emulator' }` son cómodos en local, pero todavía no son seguros para repartir dispositivos en paralelo.

## Opciones del dispositivo Android

```ts
device: {
  kind: 'emulator',
  avd: 'Pixel_9_API_35',
  autoBoot: true,
  headless: true,
  wipeData: false,
  bootTimeout: 120_000,
  emulatorArgs: ['-no-snapshot-save']
}
```

Campos:

- `avd`: nombre del dispositivo virtual, según `emulator -list-avds`
- `autoBoot`: arranca el AVD si no hay ningún emulador en línea que encaje; por defecto es `true` cuando se indica `avd`
- `headless`: añade `-no-window`; por defecto `true`
- `wipeData`: añade `-wipe-data`; útil para ejecuciones limpias en CI, destructivo para el estado del emulador
- `bootTimeout`: espera máxima para `sys.boot_completed`
- `emulatorArgs`: argumentos adicionales del emulador

## Deducción de metadatos del APK

Si la configuración solo indica:

```ts
app: {
  path: './apps/demo.apk'
}
```

Astur intenta:

```bash
aapt dump badging ./apps/demo.apk
```

Y rellena:

- `app.packageName`
- `app.activity`

Si `aapt` no está disponible, define `ASTUR_AAPT` o indica los metadatos del paquete a mano.

Astur admite tres modos de app en Android:

```ts
// Instalar un APK local.
app: { path: './apps/demo.apk' }

// Descargar el APK durante la ejecución y luego instalarlo.
app: { url: 'https://example.com/apps/demo.apk' }

// Lanzar una app ya instalada en el dispositivo.
app: { packageName: 'com.example', activity: '.MainActivity' }
```

`use.astur.timeout` define el tiempo de espera por defecto para acciones sobre elementos y aserciones móviles. Las sobrescrituras por acción siguen funcionando cuando hacen falta.

## Acciones compatibles en Android

| Área | API | Notas |
| --- | --- | --- |
| Ciclo de vida de la app | `device.app.install()`, `launch()`, `terminate()`, `reset()`, `uninstall()` | Usa por defecto el APK o paquete configurado. |
| Almacenamiento de la app | `device.app.clearData()`, `device.app.clearCache()` | Usa comandos del gestor de paquetes de Android. |
| Permisos | `device.permissions.grant('camera')`, `revoke('camera')` | Acepta nombres de permiso de Android o las abreviaturas de Astur donde existan. |
| Orientación | `device.setOrientation('landscape')`, `device.orientation.portrait()` | Usa el control de pantalla y orientación de Android. |
| Estado de bloqueo | `device.lock()`, `device.unlock()`, `device.isLocked()` | Usa las API de shell y estado del dispositivo. |
| Localizadores nativos | `getByText()`, `getByLabel()`, `getByTestId()`, `getByRole()` | Pasan por defecto por el agente nativo UIAutomator. Las consultas de múltiples coincidencias (`locator.count()`, `queryAll()`, `device.findAll()`, `device.findMany()`) también se resuelven en el dispositivo mediante `element.findAll` y `element.findMany`; las versiones del agente sin esos comandos vuelven automáticamente al camino de instantánea del árbol. |
| Coordenadas | `device.tap()`, `device.longPress()`, `device.swipe()`, `device.drag()` | Útiles para superficies de gestos y para los pasos alternativos que genera el Inspector. |
| Desplazar a la vista | `locator.scrollIntoView({ direction, maxScrolls })` | Multiplataforma. Desliza la vista de scroll que rodea al elemento hasta que es visible y devuelve su instantánea. Sustituye a los helpers de page object escritos a mano del tipo «deslizar en bucle hasta que se vea». |

Ejemplos de elementos y gestos:

```ts
await device.getByText('Continue').tap();
await device.getByLabel('Email').fill('qa@example.com');
await device.getByRole('button', { name: 'Submit' }).longPress({ durationMs: 800 });

// Desplaza un formulario largo hasta que el objetivo esté en pantalla y actúa sobre él.
await device.getByText('Submit').scrollIntoView();
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up', maxScrolls: 6 });

await device.tap({ x: 120, y: 780 });
await device.longPress({ x: 360, y: 900 }, { durationMs: 900 });
await device.swipe({
  start: { x: 500, y: 1200 },
  end: { x: 500, y: 300 },
  durationMs: 300
});
await device.drag({
  start: { x: 120, y: 1100 },
  end: { x: 360, y: 420 },
  durationMs: 800
});
```

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();

await device.back();
await device.home();
await device.recentApps();
await device.pressKey('ENTER');
await device.lock();
await device.unlock();
await device.system.isLocked();

await device.screenshot();
```

### Escribir en un control que el árbol no puede describir

`device.keyboard.type()` envía caracteres a la vista que tenga el foco, sin ningún elemento al que apuntar. Úsalo para controles que no exponen un campo rellenable: por ejemplo un OTP de varias casillas, donde las casillas son vistas planas y el campo real está oculto.

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

La misma llamada funciona en iOS, así que un solo spec cubre ambos. Prefiere `fill()` siempre que el campo sea direccionable: resuelve el elemento, lo vacía y verifica que el valor llegó, y nada de eso es posible cuando apuntas al foco.

`pressKey()` sigue la misma regla para un único carácter imprimible: escribe ese carácter en lugar de enviar un keycode, así que un bucle de OTP dígito a dígito es portable:

```ts
for (const digit of '123456') {
  await device.pressKey(digit);
}
```

Cualquier cosa de más de un carácter sigue siendo una tecla: las teclas con nombre (`'BACK'`, `'ENTER'`, `'VOLUME_UP'`) y los keycodes numéricos de Android (`'66'`) se comportan igual que antes.

Cuando el modo de endpoint del agente nativo está activado y sano, los comandos de elementos y gestos pueden ejecutarse por el transporte del agente Kotlin en el dispositivo. Si el modo de endpoint no está disponible en `auto`, Astur vuelve al comportamiento actual de ADB/UIAutomator.

`device.gestures` expone además `tap`, `longPress`, `pressAndHold`, `swipe` y `drag` como una API agrupada. `device.navigation` expone `back`, `home` y `recentApps`.

### Desplazarse a elementos fuera de pantalla

`locator.scrollIntoView()` es la forma incorporada de traer a la vista un elemento que queda por encima o por debajo del pliegue antes de actuar sobre él. Es multiplataforma (Android e iOS) y vive en todos los localizadores, así que ya no hace falta escribir a mano helpers del tipo «deslizar en bucle hasta que se vea» en los page objects. Si el elemento ya es visible, devuelve de inmediato sin desplazar nada.

```ts
// Por defecto: desplaza hacia abajo dentro del viewport, hasta 10 deslizamientos.
await device.getByText('Save changes').scrollIntoView();

// Revela algo que está por encima de la posición actual.
await device.getByLabel('Biometric login').scrollIntoView({ direction: 'up' });

// Desplaza dentro de un contenedor concreto en lugar de la pantalla entera.
await device.getById('product-42').scrollIntoView({
  container: device.getById('catalog-list'),
  maxScrolls: 15
});
```

| Opción | Por defecto | Para qué sirve |
| --- | --- | --- |
| `direction` | `'down'` | Dirección en la que desplazar el contenido hacia el objetivo: `'down'`, `'up'`, `'left'` o `'right'`. |
| `maxScrolls` | `10` | Número máximo de gestos de desplazamiento antes de rendirse. |
| `durationMs` | `400` | Duración de cada gesto de desplazamiento. |
| `container` | viewport | Elemento desplazable dentro del que deslizar. Por defecto, el viewport del dispositivo, que Astur resuelve por plataforma (viewport de iOS frente a límites del árbol en Android). |
| `timeout` / `interval` | valores de la sesión | Se pasan a la espera de visibilidad final. |

Si el elemento no aparece nunca, `scrollIntoView()` lanza un error de tiempo agotado que nombra el selector y la dirección de desplazamiento que intentó.

La gestión de apps se traduce a comandos del gestor de paquetes de ADB:

- `device.app.install(path?)` → `adb install -r`
- `device.app.uninstall(packageName?)` → `adb uninstall`
- `device.app.clearData(packageName?)` → `pm clear`
- `device.app.clearCache(packageName?)` → `pm clear --cache-only`
- `device.app.reset({ reinstall, launch })` → force-stop más `pm clear` o desinstalar e instalar
- `device.permissions.grant(permission, packageName?)` → `pm grant`
- `device.permissions.revoke(permission, packageName?)` → `pm revoke`

Los nombres cortos de permiso como `camera` se normalizan a constantes de Android como `android.permission.CAMERA`; pasa la cadena completa cuando necesites control exacto.

Los ayudantes de estado del dispositivo se traducen a comandos de keyguard y energía de Android:

- `device.lock()` / `device.system.lock()` → `KEYCODE_SLEEP`
- `device.unlock()` / `device.system.unlock()` → `KEYCODE_WAKEUP` más `wm dismiss-keyguard`
- `device.isLocked()` / `device.system.isLocked()` → estado de `dumpsys window` analizado

Las teclas de sistema de Android aceptan nombres cómodos como `BACK`, `HOME`, `ENTER`, `MENU`, `APP_SWITCH`, `RECENTS`, `VOLUME_UP` y `VOLUME_DOWN`. Los códigos de tecla en crudo como `KEYCODE_BACK` o sus valores numéricos siguen funcionando.

La suite de ejemplo de Android está dividida por funcionalidad en `examples/specs`: `login.test.ts`, `forms.test.ts`, `forms-slider.test.ts`, `media-upload.test.ts`, `tap-laboratory.test.ts`, `swipe.test.ts`, `drag-and-drop.test.ts` y `webview.test.ts`. Comparten el fixture `fixtures.ts` y el único page object en `pages/astur-demo-app.page.ts`.

## Correspondencia de localizadores

| Localizador de Astur | Origen en Android |
| --- | --- |
| `getByLabel()` / `by.label()` | `content-desc` o resource id |
| `getByTestId()` / `getById()` / `by.id()` | `resource-id` |
| `getByText()` / `by.text()` | `text` o `content-desc` |
| `getByRole()` / `by.role()` | clase de widget de Android normalizada más el nombre accesible |
| `getByType()` / `by.type()` | clase de Android |

Prefiere las etiquetas de accesibilidad y los resource id estables.

## Vía de escape a selectores nativos (`by.native`)

Para ese elemento raro que ninguna de las estrategias anteriores puede fijar — casi siempre una pantalla sin datos de accesibilidad, donde la única coincidencia fiable es por estructura o combinando varias condiciones a la vez —, `by.native()` construye una consulta de Android directamente a partir de los campos `By`/`BySelector` de androidx.test.uiautomator, la misma API que el agente incluido ya usa para todas las demás estrategias:

```ts
await device.find(by.native({
  android: {
    className: 'android.widget.Button',
    textContains: 'Save',
    // «el botón Save dentro de esta tarjeta concreta» en lugar de «el tercer
    // botón Save de toda la pantalla»:
    hasChild: { resourceId: 'com.example:id/card_title' }
  }
})).tap();

// Distingue hermanos idénticos por posición (empezando en 0, después de aplicar
// las restricciones de hasChild y hasDescendant):
await device.find(by.native({
  android: { className: 'android.widget.TextView', text: 'Delete' },
  instance: 2
})).tap();
```

| Campo de `AndroidNativeSelector` | Se traduce a |
| --- | --- |
| `className` / `classNameMatches` | `BySelector.clazz(String \| Pattern)` |
| `text` / `textContains` / `textMatches` | `BySelector.text()` / `.textContains()` / `.textMatches()` |
| `description` / `descriptionContains` / `descriptionMatches` | `BySelector.desc()` / `.descContains()` / `.descMatches()` |
| `resourceId` / `resourceIdMatches` | `BySelector.res(String \| Pattern)` |
| `packageName` | `BySelector.pkg()` |
| `hasChild` / `hasDescendant` | `BySelector.hasChild()` / `.hasDescendant()`, anidando otro `AndroidNativeSelector` |

Cada campo presente restringe más la misma consulta (AND lógico). Deliberadamente **no** es un lenguaje de expresiones arbitrario: sin `eval`, sin analizador propio y sin compilación de bytecode en tiempo de ejecución (a diferencia de la estrategia `-android uiautomator` de Appium, que necesita una para ejecutar código Java o Kotlin literal). Todo se corresponde uno a uno con un método real y comprobado de `BySelector`.

`by.native()` requiere un agente nativo conectado: no se puede resolver contra una instantánea en caché del árbol, así que una sesión heredada o sin agente lanza `NATIVE_SELECTOR_REQUIRES_AGENT` en lugar de no encontrar nada en silencio. Para apuntar también a iOS con el mismo localizador, añade una cadena de predicado `ios` junto a `android` — consulta [iOS: vía de escape a selectores nativos](../ios/#native-selector-escape-hatch-bynative).
