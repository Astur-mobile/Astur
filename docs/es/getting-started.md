# Primeros pasos con Astur

Astur es un conjunto de herramientas de automatización móvil nativa que lleva la velocidad y la ergonomía de Playwright Test directamente a los pipelines móviles. Controla Android e iOS mediante las herramientas nativas de cada plataforma, en lugar de un servidor Appium.

El nombre viene del astrolabio: un instrumento portátil que comprimió observaciones y cálculos complejos en algo lo bastante pequeño como para sostenerlo en la mano. También se inspira en el legado de Mariam al-Asturlabiya. Astur aplica la misma idea a las pruebas móviles: mantiene compacta la API de tests mientras el framework se ocupa por debajo de los agentes nativos, el ciclo de vida del dispositivo, el orden de los localizadores, las capturas, las trazas y los detalles de cada plataforma.

Esta guía está pensada para llevarte de cero a un flujo de trabajo diario y fiable.

Instala Astur en tu proyecto desde npm:

```bash
npm install -D @astur-mobile/test astur-mobile
npx astur-mobile doctor
```

Todos los comandos de esta documentación usan la forma publicada de la CLI (`npx astur-mobile …`), así que funcionan igual en cualquier proyecto una vez instalado el paquete.

Si en cambio estás desarrollando Astur desde el código fuente, instala las dependencias del workspace y compila primero:

```bash
npm install
npm run build
npx astur-mobile doctor
```

## Qué vas a conseguir

Al terminar esta guía podrás:

- ejecutar diagnósticos y validar el entorno de tu equipo
- detectar y seleccionar dispositivos de destino
- inspeccionar una app en marcha y generar código de test inicial
- configurar y ejecutar tu primer test nativo
- entender el modo alternativo frente al modo con agente nativo
- saber adónde ir después para dominar cada plataforma

## 1. Comprueba tu equipo

Ejecuta:

```bash
npx astur-mobile doctor
```

Forma esperada de la salida en macOS:

```text
Astur › doctor
Environment diagnostics

◦ Android
  ✓ PASS ADB
  ✓ PASS Android SDK

◦ iOS
  ✓ PASS Xcode
  ✓ PASS iOS simulators
  ◦ WARN iOS real-device signing
```

Linux y Windows admiten Android en local. iOS se omite porque la automatización local de iOS necesita macOS con Xcode.

Si `doctor` muestra avisos de firma para iOS real, la automatización en simulador puede ejecutarse igualmente. Automatizar un iPhone físico necesita `ASTUR_IOS_DEVELOPMENT_TEAM` para que Xcode pueda firmar el runner de XCUITest incluido.

Si empiezas por iOS, elige el camino más corto que encaje con tu objetivo:

- Prueba rápida en simulador o escritura con el Inspector: no hace falta equipo de Apple. Apunta codegen a un `.app` de simulador — `npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp`.
- Probar tu propia app en simulador: compila primero un `.app` de simulador en Xcode y defínelo como `app.path`.
- Probar en dispositivo real: usa un `.ipa` firmado para el dispositivo y define `ASTUR_IOS_DEVELOPMENT_TEAM`.

> ¿No tienes una app a mano? La app de demostración de Astur (`Astur.app` / `astur.demo.ios.ipa`, bundle id `com.astur.demo`) está en el repositorio de ejemplos, para que pruebes codegen antes de montar tu propia compilación.

## 2. Elige una plataforma

Android, el simulador de iOS y los dispositivos iOS reales conectados por USB usan por defecto el camino con agente nativo de Astur. ADB y las herramientas de Xcode siguen gestionando el ciclo de vida y los artefactos, mientras los agentes se ocupan de buscar localizadores, esperar y ejecutar acciones.

```bash
adb devices -l
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

Si ves varios dispositivos, indica identificadores exactos en la configuración para que las ejecuciones sean deterministas.

Para ejecuciones en paralelo entre plataformas, trata cada teléfono, emulador o simulador como un recurso de un solo worker. Usa un proyecto de Playwright por dispositivo, define `workers: 1` dentro de cada proyecto y pon en el `workers` de nivel superior el número de dispositivos que quieres ejecutar a la vez.

## 3. Crea los archivos del proyecto

El asistente de configuración crea la configuración inicial, tests de ejemplo y una nota de preparación:

```bash
npx astur-mobile init
```

Para valores por defecto sin interacción:

```bash
npx astur-mobile init --yes
```

Entre los archivos generados están:

- `playwright.config.ts`
- `tests/example.test.ts`
- `ASTUR_SETUP.md`
- entradas en `.gitignore` para los artefactos

## 4. Configura el runtime de tests

Crea `playwright.config.ts`. Astur puede arrancar el emulador y deducir los metadatos del paquete de Android a partir del APK:

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }]
  ],
  use: {
    astur: {
      platform: 'android',
      timeout: 20_000,
      artifacts: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
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

`use.astur.timeout` es el tiempo de espera por defecto para acciones y aserciones sobre elementos móviles. Solo necesitas sobrescribirlo por elemento en casos poco habituales:

```ts
await device.getByText('Login').tap();
await device.getByText('Slow report').tap({ timeout: 60_000 });
```

Si en tu entorno no se puede deducir los metadatos del APK, indica `packageName`. La actividad es opcional:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

También puedes descargar la app en tiempo de ejecución:

```ts
app: {
  url: 'https://example.com/apps/demo.apk'
}
```

O apuntar a una app ya instalada en el dispositivo:

```ts
app: {
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

La configuración para un dispositivo iOS real tiene la misma forma, más la preparación de firma de Apple:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

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

## 5. Inspecciona y genera un test

El Inspector de Astur es la forma más rápida de comprobar la conexión con el dispositivo, examinar localizadores nativos, grabar un flujo corto y exportar un test inicial.

```bash
npx astur-mobile codegen
```

Ejemplos habituales:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <udid-del-dispositivo> --app ./MyApp.ipa --app-id com.example.myapp
```

En el Inspector:

- haz clic en la etiqueta del dispositivo actual, en la cabecera, para cambiar de dispositivo
- usa `Controls` para instalar un APK o IPA, lanzar una app existente, conceder permisos, rotar o bloquear y desbloquear
- pulsa `Record`, interactúa con la pantalla reflejada y exporta TypeScript o JavaScript

Las capturas de iOS pueden aparecer aunque el árbol de interfaz no esté disponible. La inspección nativa en iOS requiere que el agente XCUITest conozca el bundle id de la app. Para tu propia app, pasa `--app` y `--app-id` (o define `ASTUR_IOS_BUNDLE_ID`), o usa `Controls` para lanzarla y reenlazar por bundle id. En dispositivos reales, define además `ASTUR_IOS_DEVELOPMENT_TEAM`.

Consulta [Inspector y codegen](../inspector/) para el flujo completo.

## 6. Modo opcional de endpoint del agente nativo

Astur arranca por defecto sus agentes nativos donde es posible. El modo de endpoint solo hace falta cuando ejecutas tú mismo un agente de plataforma o cuando diagnosticas el comportamiento del transporte.

Astur ya define los valores por defecto de cada plataforma. Ambas usan por defecto el modo de agente obligatorio (`automation.engine: 'agent'`, `legacyFallback: 'never'`):

- Android usa el agente UIAutomator incluido. Activa `automation.engine: 'auto'` solo si necesitas el camino heredado de ADB/XML durante una migración.
- iOS usa el modo XCUITest obligatorio porque leer el árbol de interfaz nativo y ejecutar acciones nativas no funciona de forma fiable sin el agente; no hay camino alternativo.

Con el `automation.engine: 'agent'` por defecto, las interacciones nativas nunca se degradan en silencio:

- la creación de la sesión falla si no se puede arrancar el agente
- la ejecución de comandos falla rápido cuando falla una llamada al agente

Ejemplo:

```ts
use: {
  astur: {
    platform: 'android',
    automation: {
      engine: 'agent'
    },
    agent: {
      endpoint: 'tcp:127.0.0.1:8787'
    }
  }
}
```

También se admiten endpoints por variable de entorno:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

## 7. Escribe un test

Crea `tests/login.test.ts`:

```ts
import { expect, test } from '@astur-mobile/test';

test('login screen is visible', async ({ device }) => {
  await device.app.launch();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Las aserciones nativas son al estilo Playwright y esperan automáticamente según `use.astur.timeout`:

```ts
await expect(device.getByLabel('Email')).toHaveValue('qa@example.com');
await expect(device.getByRole('button', { name: 'Submit' })).toBeEnabled();
await expect.soft(device.getByText('Optional banner')).toBeHidden();
```

## 8. Ejecuta

```bash
npx astur-mobile test
```

Para ejecutar un solo archivo:

```bash
npx astur-mobile test tests/login.test.ts
```

## 9. Siguientes pasos y buenas prácticas

:::tip[Lista de comprobación de fiabilidad]

Repasa esta lista antes de aumentar el número de tests:

1. Prefiere localizadores semánticos (`getByLabel`, `getByRole`, `getByTestId`) a las coordenadas.
2. Usa un `device.id` exacto en CI.
3. Mantén `use.astur.timeout` acorde al tiempo de carga real de tu app.
4. Activa los artefactos nativos para los fallos (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`).
5. Estabiliza el comportamiento del teclado con `keyboard.dismiss: 'auto'`, salvo que el propio teclado sea lo que estás probando.
6. Pasa de `agent.mode: 'auto'` a `agent.mode: 'required'` en cuanto valides el camino con agente nativo.
:::

## 10. Adónde ir después

- Detalle específico de Android: [Configuración de Android](../android/)
- Detalle específico de iOS: [Configuración de iOS](../ios/)
- Matriz completa de capacidades: [Configuración](../configuration/)
- Fallos habituales y sus soluciones: [Resolución de problemas](../troubleshooting/)
- Modelo general del runtime: [Arquitectura](../architecture/)

## Simulador de iOS

El paquete de iOS admite actualmente el ciclo de vida del simulador:

- listar simuladores
- instalar un `.app`
- lanzar por bundle id
- cerrar por bundle id
- captura de pantalla
- abrir URLs

Los localizadores de elementos nativos requieren el agente XCUITest en Swift.

Astur no compila tu app de simulador por ti. Si vas a probar tu propia app en simulador, compila primero un `.app` de simulador en Xcode y apunta Astur a esa salida con `--app`. Para probar Astur sin compilar nada, usa la app de demostración del repositorio de ejemplos: `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo`.

Si omites `--app` y la app no está instalada, codegen falla con `IOS_APP_NOT_INSTALLED`. Incluye `--app` en la primera ejecución para que Astur pueda instalarla antes de conectarse.

Para más detalle, consulta [Configuración de iOS](../ios/).
