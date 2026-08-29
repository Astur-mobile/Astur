---
title: "Configuración"
description: "La configuración de Astur en Playwright: capacidades, gestión de la app y artefactos."
sidebar:
  order: 6
---
Astur se integra con Playwright Test mediante `@astur-mobile/test`.

La configuración por defecto es deliberadamente pequeña: eliges una plataforma, un dispositivo y una app. Astur arranca los agentes nativos incluidos de forma automática, así que quien instala desde npm no debería necesitar compilar, instalar ni arrancar un proceso de agente aparte para las ejecuciones locales normales.

## Configuración básica

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  outputDir: 'test-results/mobile',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }],
    ['junit', { outputFile: 'test-results/mobile/results.xml' }]
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
      },
      keyboard: {
        dismiss: 'auto'
      },
      device: {
        kind: 'emulator',
        avd: 'Pixel_9_API_35',
        autoBoot: true,
        headless: true
      },
      app: {
        path: './apps/demo.apk'
      }
    }
  }
});
```

## Forma de la configuración

```ts
type AsturConfig = {
  platform: 'android' | 'ios';
  device?: {
    id?: string;
    name?: string | RegExp;
    kind?: 'emulator' | 'simulator' | 'real';
    avd?: string;
    autoBoot?: boolean;
    headless?: boolean;
    wipeData?: boolean;
    bootTimeout?: number;
    emulatorArgs?: string[];
    cloud?: {
      provider: 'browserstack';
      deviceName?: string;
      osVersion?: string;
      project?: string;
      build?: string;
      appId?: string;
      usernameEnv?: string;
      accessKeyEnv?: string;
    };
  };
  app?: string | {
    path?: string;
    url?: string;
    downloadPath?: string;
    bundleId?: string;
    packageName?: string;
    activity?: string;
  };
  timeout?: number;
  artifactsDir?: string;
  artifacts?: {
    screenshot?: 'off' | 'on' | 'only-on-failure';
    video?: 'off' | 'on' | 'retain-on-failure';
  };
  keyboard?: {
    dismiss?: 'auto' | 'preserve';
  };
  agent?: {
    mode?: 'auto' | 'required' | 'off';
    install?: boolean;
    endpoint?: string;
    launchTimeout?: number;
    commandTimeout?: number;
  };
};
```

## Flujo de trabajo recomendado

Sigue esta progresión para una adopción estable:

<ol class="astur-steps">
  <li>Empieza sin secciones <code>automation</code> ni <code>agent</code>; Astur usa por defecto el motor con agente nativo.</li>
  <li>Valida las aserciones nativas y la fiabilidad de las acciones sobre los flujos reales de tu app.</li>
  <li>Usa <code>automation.engine: 'auto'</code> solo mientras migras del comportamiento heredado de ADB/XML.</li>
  <li>Usa <code>automation.engine: 'legacy-adb'</code> solo cuando compares o diagnostiques el camino antiguo a propósito.</li>
</ol>

`device.cloud` es hoy un esqueleto para una futura ejecución en la nube. Los emuladores de Android locales, los dispositivos Android reales locales, los simuladores de iOS locales y los dispositivos iOS reales conectados por USB sí se pueden ejecutar hoy, siempre que estén las herramientas de plataforma y la configuración de firma necesarias.

`timeout` es el presupuesto de espera por defecto para las acciones y aserciones de los localizadores de Astur. Sobrescríbelo solo donde un elemento concreto necesite otro presupuesto:

```ts
await device.getByLabel('Login').tap();
await device.getByLabel('Slow report').tap({ timeout: 60_000 });
```

El control de la orientación es neutral respecto a la plataforma cuando el driver seleccionado lo admite:

```ts
await device.setOrientation('landscape');
await device.orientation.portrait();
```

Usa el cierre y arranque de la app por test para el aislamiento normal. Mantén la instalación y el arranque del agente nativo a nivel de sesión de worker, salvo que estés probando a propósito la instalación del agente o la migración de datos de la app.

Los dispositivos iOS reales necesitan una variable de entorno más, porque Apple exige que el runner de XCUITest vaya firmado:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

Si trabajas desde el código fuente, Astur puede deducir el equipo del proyecto Xcode firmado en `agents/ios-xctest-agent`. Las instalaciones publicadas desde npm y los entornos de CI deberían definir `ASTUR_IOS_DEVELOPMENT_TEAM` de forma explícita.

Astur prefiere el túnel USB de Xcode/CoreDevice para el puente del agente en dispositivo real. Define `ASTUR_IOS_AGENT_HOST` con una dirección de red del Mac solo cuando tu entorno no pueda usar ese túnel.

## Referencia de capacidades del runtime

Las capacidades de Astur viven bajo el `use.astur` de Playwright. Los ajustes propios de Playwright, como `testDir`, `timeout`, `workers`, `reporter`, `outputDir`, `screenshot`, `video` y `trace`, se comportan exactamente igual que en Playwright Test. Los ajustes propios de Astur describen la plataforma móvil, el dispositivo elegido, la app bajo prueba y los artefactos nativos.

| Campo | Obligatorio | Por defecto | Descripción |
| --- | --- | --- | --- |
| `platform` | Sí | ninguno | Plataforma de destino: `'android'` o `'ios'`. |
| `device` | No | `{}` | Elige un emulador, simulador o dispositivo real. Si se omite, Astur elige el primer dispositivo compatible que esté en línea. |
| `app` | No | `undefined` | App bajo prueba. Puede ser una cadena con la ruta local, un objeto de app, un objeto con URL de descarga o los metadatos de una app ya instalada. |
| `timeout` | No | `10_000` | Presupuesto de espera por defecto para acciones de localizador y aserciones nativas. |
| `artifactsDir` | No | carpeta de salida de Playwright acotada a la sesión del worker | Sobrescritura avanzada para los artefactos nativos, las apps descargadas y las salidas nativas temporales. La mayoría de proyectos deberían omitirlo. Las capturas y vídeos por test se siguen adjuntando por la salida de test de Playwright. |
| `artifacts.screenshot` | No | `off` | Modo de adjuntar capturas nativas: `off`, `on` o `only-on-failure`. |
| `artifacts.video` | No | `off` | Modo de grabación nativa de pantalla: `off`, `on` o `retain-on-failure`. Las ejecuciones en Android y en simulador de iOS pueden adjuntar vídeo. Las de dispositivo iOS real se saltan la captura y continúan. |
| `keyboard.dismiss` | No | `auto` | Estrategia del teclado en pantalla. `auto` lo cierra solo cuando bloquea el objetivo de un puntero; `preserve` lo deja abierto. |
| `automation.engine` | No | `agent` (Android e iOS) | Motor de automatización. `agent` usa el camino con agente nativo, `auto` permite el retroceso al camino heredado durante una migración (solo Android) y `legacy-adb` fuerza el antiguo camino de shell y XML de Android. |
| `automation.legacyFallback` | No | `never` (pasa a `on-agent-failure` automáticamente con `engine: 'auto'`) | Controla si Astur puede pasar del agente a las herramientas de plataforma heredadas. |
| `agent.mode` | No | derivado de `automation.engine` | Alias de compatibilidad. `required` equivale a `automation.engine: 'agent'`, `auto` permite el retroceso y `off` fuerza las herramientas heredadas. |
| `agent.install` | No | `true` | Permite al driver instalar y arrancar su agente nativo donde sea posible. El fixture arranca una sesión de Astur por worker de Playwright, no una por spec. Usa cierre y arranque de la app para el aislamiento normal por spec, y reserva el reinicio o reinstalación de datos para los tests que lo necesiten. |
| `agent.endpoint` | No | `undefined` | Endpoint opcional del agente nativo. Acepta los formatos `http://`, `https://`, `tcp:host:puerto` o `host:puerto` a secas. |
| `agent.launchTimeout` | No | Android: `30_000`; iOS: `60_000` | Presupuesto de tiempo para el saludo inicial del agente al comenzar la sesión. |
| `agent.commandTimeout` | No | Android: `20_000`; iOS: `15_000` | Presupuesto de tiempo para cada comando del agente. |

Astur usa por defecto el agente nativo en ambas plataformas (`engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`), de modo que las interacciones nativas nunca se degradan en silencio. En Android puedes optar por `automation.engine: 'auto'` para conservar seguridad durante una migración: solo recurre a las herramientas heredadas de ADB/XML cuando el agente nativo no consigue arrancar. En iOS el agente XCUITest es obligatorio para leer el árbol de interfaz y ejecutar acciones nativas, así que no hay camino alternativo; Astur falla rápido en lugar de ejecutar una sesión a medias.

Estos valores de tiempo afectan más a la fiabilidad que a la velocidad de las acciones. Las acciones normales siguen terminando en cuanto responde el agente; el tiempo de espera es el presupuesto máximo para un arranque en frío del agente, un simulador lento, la hidratación de la app o un comando atascado.

## Sobrescrituras del endpoint del agente nativo

Astur mantiene simple la API de tests y empuja la complejidad a la capa del runtime. La mayoría de proyectos deberían omitir `automation` y `agent` por completo. Si ejecutas tú mismo un agente de plataforma, apunta Astur a él con `use.astur.agent.endpoint` o con una variable de entorno por plataforma:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

```ts
use: {
  astur: {
    platform: 'android',
    agent: {
      mode: 'auto',
      endpoint: 'tcp:127.0.0.1:8787'
    }
  }
}
```

Usa `automation.engine: 'agent'` de forma explícita en CI de Android cuando las interacciones nativas no deban recurrir al camino heredado en silencio. iOS ya usa por defecto el modo XCUITest obligatorio.

## Variables de entorno de iOS

Astur funciona sin ninguna variable de entorno en un simulador. Las de abajo cubren la firma en dispositivos reales, el control avanzado del agente y la depuración. La mayoría de proyectos solo llegan a definir `ASTUR_IOS_DEVELOPMENT_TEAM` (para dispositivos reales).

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `ASTUR_IOS_DEVELOPMENT_TEAM` | se deduce del proyecto del agente al trabajar desde el código fuente | Team ID de Apple con el que se firma el agente XCUITest incluido. **Obligatorio en dispositivos reales.** |
| `ASTUR_IOS_CODE_SIGN_IDENTITY` | automático | Fuerza una identidad de firma concreta para la compilación del agente. |
| `ASTUR_IOS_ALLOW_PROVISIONING_UPDATES` | activado | Ponlo a `0` para quitar `-allowProvisioningUpdates` cuando tu CI gestione los perfiles por su cuenta. |
| `ASTUR_IOS_AGENT_HOST` | túnel USB de CoreDevice y, si no, una dirección de red alcanzable | Dirección del Mac a la que se conecta el agente del dispositivo. Defínela solo cuando el puente detectado no sea alcanzable. |
| `ASTUR_IOS_AGENT_BIND_HOST` | `127.0.0.1` (simulador) / `0.0.0.0` o `::` (real) | Interfaz a la que se enlaza el puente del host. |
| `ASTUR_IOS_AGENT_PORT` | puerto libre aleatorio | Puerto fijo del host para el puente del agente. |
| `ASTUR_IOS_AGENT_ENDPOINT` | sin definir | Conectarse a un agente de iOS arrancado externamente en lugar de arrancar uno. |
| `ASTUR_IOS_AGENT_PROJECT` | el incluido `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` | Ruta a un proyecto Xcode propio del agente XCUITest. |
| `ASTUR_IOS_AGENT_SCHEME` | `AsturIOSAgent` | Esquema con el que se compila el agente. |
| `ASTUR_IOS_AGENT_DERIVED_DATA` | una ruta temporal indexada por dispositivo y fuente del agente | Cambia la ubicación de la caché de compilación del agente. |
| `ASTUR_IOS_AGENT_START_ATTEMPTS` | `2` (simulador) / `1` (real) | Cuántas veces reintentar el arranque del agente antes de fallar. |
| `ASTUR_IOS_AGENT_REAP` | activado | Ponlo a `0` para que Astur no mate las sesiones de agente que quedaron para el mismo dispositivo antes de una ejecución nueva. |
| `ASTUR_IOS_AGENT_TRACE` | desactivado | Ponlo a `1` para registrar cada comando del puente (encolado, entrega, respuesta, tiempo agotado): la primera herramienta a la que recurrir cuando una sesión se cuelga. |
| `ASTUR_ANDROID_APP_FORCE_INSTALL` | desactivado | Ponlo a `1` para desinstalar el paquete de Android existente y luego instalar la app de `--app` o `app.path`. Esto borra los datos de la app y admite builds que comparten identificador de paquete pero usan firmas distintas. |
| `ASTUR_IOS_APP_FORCE_INSTALL` | desactivado | Ponlo a `1` para reinstalar la app de `--app` o `app.path` aunque ya esté instalada. |
| `ASTUR_XCRUN` / `ASTUR_XCODEBUILD` | `xcrun` / `xcodebuild` en el `PATH` | Rutas absolutas a las herramientas de Apple, para instalaciones de Xcode no estándar. |

Las configuraciones de ejemplo leen además `ASTUR_IOS_DEVICE_KIND`, `ASTUR_IOS_DEVICE_ID`, `ASTUR_IOS_DEVICE_NAME`, `ASTUR_IOS_BUNDLE_ID` y `ASTUR_IOS_APP_PATH` para elegir dispositivo y app sin editar el archivo.

## Selección de dispositivo

Usa `npx astur-mobile devices` para ver identificadores y nombres. Prefiere `device.id` para que CI y las ejecuciones en paralelo sean deterministas. Usa `device.name` cuando el nombre exacto del simulador o emulador sea estable y solo se espere un dispositivo coincidente.

`platform` elige el driver. `device.kind` no decide entre Android e iOS; solo acota la selección cuando `id` no es lo bastante específico o cuando quieres a propósito un selector suelto como «cualquier emulador». Si defines `device.id`, mantén `kind` cuando quieras un filtro de validación extra o quieras que Astur se ahorre búsquedas irrelevantes, por ejemplo `kind: 'real'` para un iPhone físico.

| Campo | Emulador Android | Android real | Simulador iOS | iOS real |
| --- | --- | --- | --- | --- |
| `id` | serial de ADB, p. ej. `emulator-5554` | serial de ADB, p. ej. `R5CT...` | UDID del simulador, según `simctl` | UDID del dispositivo, según `devicectl`, p. ej. `00008030...` |
| `name` | nombre de modelo de `adb devices -l` | nombre de modelo de `adb devices -l` | nombre del simulador, p. ej. `iPhone 16 Pro` | nombre del dispositivo, según `devicectl` |
| `kind` | filtro opcional: `emulator` | filtro opcional: `real` | filtro opcional: `simulator` | filtro opcional: `real` |
| `avd` | nombre del dispositivo virtual, p. ej. `Pixel_9_API_35` | no se usa | no se usa | no se usa |
| `autoBoot` | arranca el `avd` configurado si no hay emulador en línea que encaje | no se usa | no se usa | no se usa |
| `headless` | añade `-no-window` cuando Astur arranca el emulador, salvo que sea `false` | no se usa | no se usa | no se usa |
| `wipeData` | añade `-wipe-data` cuando Astur arranca el emulador | no se usa | no se usa | no se usa |
| `bootTimeout` | espera máxima a que termine el arranque del emulador | no se usa | no se usa | no se usa |
| `emulatorArgs` | argumentos adicionales del emulador | no se usa | no se usa | no se usa |
| `cloud` | solo esqueleto de BrowserStack | solo esqueleto de BrowserStack | solo esqueleto de BrowserStack | solo esqueleto de BrowserStack |

Los identificadores de dispositivos Android salen de:

```bash
adb devices -l
npx astur-mobile devices --android
```

Los de simuladores y dispositivos iOS reales salen de:

```bash
xcrun simctl list devices available
xcrun devicectl list devices
npx astur-mobile devices --ios
```

Para iOS real, define `ASTUR_IOS_DEVELOPMENT_TEAM` y usa una app firmada para el dispositivo conectado. Astur compila y lanza el agente XCUITest incluido automáticamente.

Si hay un iPhone real conectado por USB, Astur anuncia un endpoint de túnel CoreDevice al runner de XCUITest. Evita fijar `ASTUR_IOS_AGENT_HOST` a mano salvo que tu dispositivo alcance al Mac por la red local a propósito.

## Recetas de configuración de dispositivo

Emulador de Android por nombre de AVD, con arranque automático:

```ts
astur: {
  platform: 'android',
  device: {
    kind: 'emulator',
    avd: 'Pixel_9_API_35',
    autoBoot: true,
    headless: true,
    bootTimeout: 120_000
  }
}
```

Emulador de Android por serial de ADB activo:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'emulator-5554'
  }
}
```

Dispositivo iOS real por UDID:

```ts
astur: {
  platform: 'ios',
  device: {
    kind: 'real',
    id: '00008030-000548220EF0802E'
  },
  app: {
    path: './apps/Demo.ipa',
    bundleId: 'com.example.demo'
  }
}
```

Dispositivo Android real por serial de ADB:

```ts
astur: {
  platform: 'android',
  device: {
    id: 'R5CT123456A'
  }
}
```

Simulador de iOS por nombre:

```ts
astur: {
  platform: 'ios',
  device: {
    name: 'iPhone 16 Pro'
  }
}
```

Simulador de iOS por UDID:

```ts
astur: {
  platform: 'ios',
  device: {
    id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC'
  }
}
```

Ejemplos de selectores poco específicos en Android:

```ts
// Cualquier emulador de Android en línea.
device: { kind: 'emulator' }

// Cualquier dispositivo Android real en línea.
device: { kind: 'real' }
```

Las ejecuciones en paralelo sobre varios dispositivos deberían usar projects de Playwright con valores únicos de `device.id`:

```ts
projects: [
  {
    name: 'android-phone',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5554' } } }
  },
  {
    name: 'android-tablet',
    workers: 1,
    use: { astur: { platform: 'android', device: { id: 'emulator-5556' } } }
  }
]
```

No dejes que dos projects elijan el mismo dispositivo. Y limita cada project de dispositivo físico con `workers: 1`. El `workers` de nivel superior de Playwright controla el conjunto global de workers, pero sin un límite por project todavía puede planificar dos archivos de spec del mismo project móvil a la vez. Astur crea además una reserva de dispositivo en el host por cada sesión de worker y falla rápido si un segundo worker intenta reservar el mismo dispositivo configurado.

## Referencia de capacidades de la app

| Campo | Android | Simulador iOS | Descripción |
| --- | --- | --- | --- |
| `app: './apps/demo.apk'` | Sí | No | Abreviatura para una ruta de app local. En Android apunta a un APK. |
| `path` | ruta del APK | ruta del paquete `.app` o un `.ipa` compatible con simulador | App local que se instala antes de empezar la sesión. |
| `url` | URL de descarga del APK | previsto | Descarga la app al materializar las capacidades y luego la instala desde `downloadPath`. |
| `downloadPath` | opcional | opcional | Dónde guarda Astur una app descargada desde `url`. Por defecto, dentro de la carpeta de artefactos nativos derivada. |
| `packageName` | paquete de Android, p. ej. `com.example` | solo se acepta como respaldo | Necesario para lanzar apps de Android ya instaladas, desinstalar, borrar datos o caché y para llamadas explícitas de ciclo de vida. Se deduce del APK cuando `aapt` está disponible. |
| `activity` | actividad de arranque de Android, p. ej. `.MainActivity` | no se usa | Opcional. Si se omite, Astur usa el intent de lanzador de Android mediante `monkey`. |
| `bundleId` | solo se acepta como respaldo | bundle id de iOS, p. ej. `com.example.demo` | Necesario para lanzar, cerrar, desinstalar y reiniciar en iOS. |

Configuraciones de app habituales:

```ts
// Android: instalar un APK local.
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: descargar el APK durante la ejecución.
app: {
  url: 'https://example.com/apps/demo.apk',
  downloadPath: 'test-results/downloads/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Android: app ya instalada en el dispositivo.
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}

// Simulador de iOS: instalar un paquete .app local.
app: {
  path: './apps/Demo.app',
  bundleId: 'com.example.demo'
}

// Simulador de iOS: app ya instalada.
app: {
  bundleId: 'com.example.demo'
}
```

## Informes y artefactos nativos

Reporters y artefactos de Playwright:

| Campo de Playwright | Para qué sirve |
| --- | --- |
| `reporter` | Configura los reporters HTML, list, JUnit, JSON u otros de Playwright. |
| `outputDir` | Guarda trazas, capturas, vídeos y salida de test de Playwright. |
| `use.screenshot` | Política de capturas de Playwright y del navegador. |
| `use.video` | Política de vídeo de Playwright y del navegador. |
| `use.trace` | Política de trazas de Playwright. |

Artefactos nativos de Astur:

| Campo de Astur | Para qué sirve |
| --- | --- |
| `use.astur.artifactsDir` | Sobrescritura avanzada del almacenamiento de artefactos nativos. Omítelo en ejecuciones normales de Playwright; Astur deriva una carpeta acotada al worker mientras adjunta capturas y vídeos por test. |
| `use.astur.artifacts.screenshot` | Captura pantallas nativas mediante ADB o simctl y las adjunta al informe de Playwright. |
| `use.astur.artifacts.video` | Graba la pantalla nativa mediante ADB o simctl y adjunta o conserva según el modo configurado. |

Usa ambas capas cuando un test mezcle automatización móvil nativa con automatización de WebView o navegador.

`use.astur.artifacts` controla la política de captura nativa. Está deliberadamente separada de `use.screenshot`, `use.video` y `use.trace` de Playwright, porque esos ajustes se aplican a artefactos de navegador y página. No definas `use.astur.artifactsDir` salvo que necesites una raíz de almacenamiento propia; las ejecuciones normales heredan automáticamente la estructura de salida por test de Playwright.

## Aserciones nativas

El `expect` de `@astur-mobile/test` funciona con localizadores nativos de Astur y con localizadores DOM de Playwright. Las aserciones sobre localizadores nativos esperan automáticamente según `use.astur.timeout`, salvo que se indique un tiempo propio en el matcher:

```ts
await expect(device.getByText('Welcome')).toBeVisible();
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled({ timeout: 5_000 });
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

Matchers nativos de `MobileLocator`:

- `toBeVisible`, `toBeHidden`, `toExist`
- `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeFocused`, `toBeChecked`
- `toHaveText`, `toContainText`, `toHaveValue`, `toBeEmpty`
- `toHaveLabel`, `toHaveType`, `toHaveBounds`, `toHaveCount`
- `toHaveScreenshot` — consulta [Comparación visual](../visual-comparison/)

## Manejo del teclado en pantalla

Por defecto, Astur trata el teclado del dispositivo como una capa superpuesta. Las acciones de puntero por localizador o por coordenadas comprueban si el teclado está visible y si tapa el punto de destino. Si lo tapa, Astur lo cierra, espera un instante a que el layout se asiente y vuelve a resolver el localizador antes de tocar o mantener pulsado.

```ts
use: {
  astur: {
    keyboard: {
      dismiss: 'auto'
    }
  }
}
```

Usa `preserve` cuando un test interactúe con la interfaz del teclado a propósito:

```ts
await device.getByLabel('Search').tap({ keyboard: 'preserve' });
```

Para un control explícito, usa el ayudante de teclado del dispositivo en lugar de enviar una tecla Atrás a ciegas:

```ts
await device.getByLabel('Password').fill('secret');
await device.keyboard.dismiss();
await device.keyboard.hide(); // alias de dismiss()
await device.keyboard.show(device.getByLabel('Password'));
await device.getByRole('button', { name: 'Sign in' }).tap();
```

El relleno en iOS usa `typeText` de XCTest para valores seguros y cortos, y una vía basada en pegado para reemplazos largos no seguros. El pegado sigue disponible como opción explícita cuando quieras forzarlo en un campo no seguro concreto:

```ts
await device.getByLabel('Name').fill('Amr');
await device.getByLabel('Bio').fill('Long local-only text', { textInputMode: 'paste' });
```

## Contextos nativos y de WebView

Las pantallas nativas usan localizadores de Astur respaldados por los árboles de interfaz de la plataforma:

```ts
await device.getByLabel('Login').tap();
await expect(device.getByText('Credentials')).toBeVisible();
```

Las pantallas con WebView se pueden manejar por el DOM del navegador. El camino recomendado es `device.webContext()`, una API independiente del motor que actúa **dentro de la página** sobre el transporte de depuración de la WebView, así que es inmune a la limitación de `requestAnimationFrame` que aplica una WebView fuera de pantalla (y que a veces bloquea las comprobaciones de accionabilidad de Playwright). Funciona igual para Flutter y React Native:

```ts
import { expect, test } from '@astur-mobile/test';

test('webview content', async ({ device }) => {
  await device.app.launch();
  await device.getById('tab-web').tap();

  const web = await device.webContext();
  await web.getById('astur-email').fill('qa@astur.dev');
  await web.getById('astur-submit').tap();
  expect(await web.getById('astur-result').textContent()).toMatch(/Submitted/i);

  await web.close();
});
```

Para tener toda la ergonomía de Playwright, puedes obtener en su lugar un objeto `web.page` con el fixture `webview` (solo en Android: usa el Chrome DevTools Protocol, así que la app debe activar la depuración de WebView):

```ts
const web = await webview({ timeout: 30_000 });
await expect(web.page.locator('body')).toContainText(/Astur Web Lab/);
// Las WebViews fuera de pantalla limitan rAF, lo que puede bloquear la
// comprobación de estabilidad de Playwright: usa { force: true } en acciones
// sensibles a rAF, o mejor device.webContext() como arriba.
await web.page.getByRole('button', { name: /Submit web form/i }).click({ force: true });
```

`device.contexts()` lista los contextos nativos y de WebView. `device.webContext()` (el puente al DOM independiente del motor) funciona en **Android e iOS, en simulador y en dispositivos reales**. El fixture `webview()` basado en Page de Playwright (`web.page`) sigue siendo **solo de Android** (necesita CDP de Chromium); en iOS lanza `WEBVIEW_NOT_SUPPORTED`, así que usa allí `device.webContext()` o localizadores nativos. El modo nativo sigue disponible en ambas plataformas para barras de navegación, botones del sistema, permisos y demás elementos del sistema o de la app que quedan fuera de la WebView.

## Gestión de la app y del dispositivo

Astur expone el ciclo de vida de la app, los permisos, la orientación y los comandos de estado del dispositivo a través del mismo fixture.

| API | Android | Simulador iOS | Notas |
| --- | --- | --- | --- |
| `await device.app.install()` | Sí | Sí | Instala el `use.astur.app.path` configurado. Android espera un APK. iOS espera un `.app` o un IPA compatible con simulador. |
| `await device.app.launch()` | Sí | Sí | Lanza el nombre de paquete o bundle id configurado. |
| `await device.app.terminate()` | Sí | Sí | Detiene la app configurada sin desinstalarla. |
| `await device.app.reset({ reinstall: true, launch: true })` | Sí | Sí | Reinstala desde `app.path` y, opcionalmente, lanza. Úsalo para dejar limpios los datos de la app en el simulador de iOS. |
| `await device.app.clearData()` | Sí | No | Borrado de datos del paquete en Android. iOS usa el reinicio por reinstalación. |
| `await device.app.clearCache()` | Sí | No | Borrado de caché del paquete en Android. iOS no expone un equivalente directo. |
| `await device.app.uninstall()` | Sí | Sí | Elimina la app configurada. |
| `await device.permissions.grant('camera')` | Sí | Sí | Android usa los permisos del gestor de paquetes. El simulador de iOS usa `simctl privacy`. |
| `await device.permissions.revoke('camera')` | Sí | Sí | Misma correspondencia por plataforma que al conceder. |
| `await device.setOrientation('landscape')` | Sí | Sí | Define la orientación mediante el driver de la plataforma elegida. |
| `await device.orientation.portrait()` | Sí | Sí | Ayudante de conveniencia para el modo vertical. |
| `await device.lock()` | Sí | Sí | Bloquea el dispositivo o simulador donde esté soportado. |
| `await device.unlock()` | Sí | Sí | Despierta o desbloquea el destino cuando es posible. |
| `await device.isLocked()` | Sí | Sí | Devuelve el estado de bloqueo observado cuando la plataforma lo expone. |

Todos los comandos de app usan por defecto `use.astur.app`. Pasa un nombre de paquete o bundle id cuando gestiones otra app instalada:

```ts
await device.app.clearData('com.example.other');
await device.app.uninstall('com.example.other');
await device.permissions.grant('photos', 'com.example.other');
```

Android implementa la gestión de datos, caché y permisos mediante comandos del gestor de paquetes de ADB. El simulador de iOS admite instalar, desinstalar, lanzar, cerrar, reiniciar por reinstalación y conceder o revocar permisos con `simctl privacy`; el borrado directo de datos o caché por app no lo expone `simctl`.

## Ayudantes reutilizables del runtime

Astur exporta pequeños ayudantes para las cuentas habituales de los page objects y el recorrido de instantáneas, para que no haya que duplicarlos.

| Ayudante | Para qué |
| --- | --- |
| `centerOf(bounds)` | Devuelve la coordenada central de un elemento o de los límites de la pantalla. |
| `pointInBounds(bounds, xRatio, yRatio)` | Devuelve una coordenada dentro de unos límites, por ejemplo `pointInBounds(screen.bounds, 0.5, 0.82)`. |
| `flattenTree(snapshot)` | Aplana un árbol de interfaz nativo en una lista de instantáneas por la que se puede buscar. |
| `findElement(snapshot, selector)` | Aplica la coincidencia de selectores de Astur a una instantánea. Útil para diagnósticos y lecturas propias de un page object. |

Mantén el conocimiento específico de la app, del tipo «lee el contador del Tap Laboratory», dentro de tu page object. Deja la geometría genérica, el recorrido del árbol y la coincidencia de localizadores en los ayudantes de Astur.

## Capturas y archivos del dispositivo

Captura una pantalla nativa como `Buffer`, o guárdala directamente:

```ts
const image = await device.screenshot();
await device.screenshot({ path: 'test-results/screens/home.png' });
```

Usa `device.files` para preparar tests y para diagnósticos. En Android esto usa la transferencia de archivos de ADB:

```ts
await device.files.push('./fixtures/avatar.png', '/sdcard/Download/avatar.png');

const logs = await device.files.pull('/sdcard/Download/app.log');
await device.files.save('/sdcard/Download/app.log', 'test-results/device/app.log');

const downloads = await device.files.list('/sdcard/Download');
await device.files.remove('/sdcard/Download/avatar.png');
```

Resulta útil para preparar escenarios con el selector de archivos, recoger archivos generados y guardar logs o exportaciones de la app después de un test. La transferencia de archivos en iOS no está expuesta todavía, a propósito, porque necesita un tratamiento consciente del contenedor de la app.

## Proyectos multiplataforma

Usa projects de Playwright:

### Android e iOS en paralelo

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">EJECUCIÓN EN PARALELO</span>
    <strong>Android e iOS, una sola ejecución de Playwright.</strong>
    <p>Mira cómo Astur coordina ambas plataformas a la vez, con dispositivos aislados y un flujo de tests compartido.</p>
    <a class="astur-video-link" href="https://youtu.be/H1-cRGLqu2U" target="_blank" rel="noreferrer">Ver en YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/H1-cRGLqu2U" title="Ejecución en paralelo de tests de Astur en Android e iOS" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  projects: [
    {
      name: 'android-pixel',
      use: {
        astur: {
          platform: 'android',
          device: { id: 'emulator-5554' },
          app: {
            path: './apps/demo.apk',
            packageName: 'com.example'
          }
        }
      }
    },
    {
      name: 'ios-sim',
      use: {
        astur: {
          platform: 'ios',
          device: { name: 'iPhone 16 Pro' },
          app: {
            path: './apps/Demo.app',
            bundleId: 'com.example.demo'
          }
        }
      }
    }
  ]
});
```

Para ejecuciones en paralelo, indica selectores de dispositivo únicos por project:

- Emulador Android más emulador Android: usa valores distintos de `device.id`, como `emulator-5554` y `emulator-5556`.
- Emulador Android más dispositivo Android real: prefiere identificadores exactos como `{ id: 'emulator-5554' }` y `{ id: 'R5CT123456A' }`.
- Android más iOS: usa projects de plataforma separados con dispositivos físicos o virtuales separados.
- Simulador de iOS más iPhone real: usa valores distintos de `device.id` y asegúrate de que la app y el runner de XCUITest del dispositivo real están firmados.

El ejemplo `examples/config/android/playwright.parallel.config.ts` ejecuta un project de Android y otro de simulador de iOS en paralelo. Usa `ASTUR_ANDROID_DEVICE_ID`, `ASTUR_IOS_DEVICE_ID`, `ASTUR_IOS_DEVICE_NAME` y `ASTUR_IOS_BUNDLE_ID` como sobrescrituras opcionales.

Astur reserva cada dispositivo configurado por sesión de worker. Si dos workers eligen el mismo dispositivo físico, el segundo falla con un error de reserva en lugar de pelearse por la app en silencio. Pon en el `workers` de nivel superior el número de dispositivos disponibles, mantén únicos los selectores de cada project y define `workers: 1` dentro de cada project que apunte a un dispositivo físico.

Un solo teléfono o simulador no puede ejecutar dos sesiones nativas de app a la vez. El paralelismo viene de tener varios dispositivos: dos dispositivos para dos workers, tres para tres, y así. Esto vale igual para emuladores de Android, dispositivos Android reales, simuladores de iOS y dispositivos iOS reales.

Al filtrar una ejecución en paralelo a un archivo y un project, pasa el archivo antes de `--project`:

```bash
npm run test:parallel:spec -- specs/login.test.ts --project ios-simulator
```

`--project` acepta varios valores en Playwright, así que cualquier cosa que venga después puede interpretarse como otro nombre de project.
