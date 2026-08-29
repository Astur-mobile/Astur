---
title: "Referencia de la CLI"
description: "Los comandos doctor, devices, init, codegen, inspect, screenshot y test."
sidebar:
  order: 8
---
Astur se publica en el paquete `astur-mobile` porque el nombre `astur` sin ámbito ya está ocupado en npm. El ejecutable sigue llamándose `astur`.

Desde este repositorio:

```bash
npx astur-mobile <comando>
```

Tras la instalación local, npm expone además:

```bash
npx astur <comando>
```

## `doctor`

Comprueba los requisitos del equipo.

```bash
npx astur-mobile doctor
npx astur-mobile doctor --verbose
```

La salida por defecto oculta los errores largos de los comandos. Usa `--verbose` para ver la salida completa de ADB, Xcode o el simulador.

## `devices`

Lista dispositivos Android, simuladores de iOS y dispositivos iOS reales conectados.

```bash
npx astur-mobile devices
npx astur-mobile devices --android
npx astur-mobile devices --ios
```

Usa el valor `id` que se imprime como `use.astur.device.id` en `playwright.config.ts`. En Android es el número de serie de ADB, como `emulator-5554` para un emulador o el serial USB de un dispositivo real. En iOS es el UDID del simulador según `simctl`, o el UDID del dispositivo físico según `devicectl`.

`platform` elige el driver de Android o de iOS. `device.kind` es solo un filtro opcional para selección poco específica, por ejemplo «cualquier emulador» o «cualquier dispositivo Android real». Cuando indicas un `id` concreto, normalmente no hace falta `kind`.

Ejemplos:

```ts
// Emulador de Android ya en marcha.
device: { id: 'emulator-5554' }

// Dispositivo Android real, según adb devices -l.
device: { id: 'R5CT123456A' }

// Simulador de iOS por UDID.
device: { id: '4E2F2A1D-9B8A-4D41-8E5F-123456789ABC' }

// Simulador de iOS por nombre.
device: { name: 'iPhone 16 Pro' }

// Dispositivo iOS real por UDID.
device: { kind: 'real', id: '00008030-000548220EF0802E' }

// Selector poco específico: cualquier emulador de Android en línea.
device: { kind: 'emulator' }
```

En Linux y Windows, `--ios` imprime un mensaje sobre la limitación de plataforma en lugar de fallar.

## `init`

Ejecuta un asistente de configuración y crea los archivos iniciales:

```bash
npx astur-mobile init
```

Para CI, demostraciones o terminales no interactivas, usa los valores por defecto del emulador de Android:

```bash
npx astur-mobile init --yes
```

El asistente pregunta por:

- Android, iOS o ambos
- emulador, simulador, dispositivo real o configuración de marcador para BrowserStack
- ruta local de la app, URL de descarga o paquete/bundle ya instalado
- tiempo de espera por defecto para elementos móviles
- informes HTML y JUnit
- ajustes de captura nativa, vídeo nativo y trazas de Playwright

Archivos generados:

- `playwright.config.ts`
- `tests/example.test.ts`
- `.gitignore`
- `ASTUR_SETUP.md`

Los archivos existentes no se sobrescriben.

La configuración de BrowserStack se genera con las variables de entorno esperadas, pero la ejecución en la nube no está implementada en la beta actual. Los caminos de emulador, simulador y dispositivo real en local sí se pueden ejecutar hoy.

## `test`

Ejecuta Playwright Test:

```bash
npx astur-mobile test
npx astur-mobile test tests/login.test.ts
npx astur-mobile test --project android-pixel
```

Usa `playwright.config.ts` para controlar el modo del agente nativo y el comportamiento del endpoint:

- `agent.mode: 'auto'` para migraciones y entornos mixtos
- `agent.mode: 'required'` para exigirlo estrictamente en CI
- `agent.mode: 'off'` para forzar las herramientas de plataforma alternativas

Variables de entorno del endpoint por plataforma:

- `ASTUR_ANDROID_AGENT_ENDPOINT`
- `ASTUR_IOS_AGENT_ENDPOINT`

## `codegen`

Arranca una sesión de inspector y codegen respaldada por el runtime, usando el mismo motor de localizadores que `@astur-mobile/core`.

```bash
npx astur-mobile codegen
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <udid-del-dispositivo> --app ./MyApp.ipa --app-id com.example.myapp
```

Comportamiento en la beta actual:

- selecciona automáticamente un dispositivo en línea o arrancado (o usa `--device`)
- opcionalmente instala y lanza la app cuando se indican `--app` o `--app-id`
- abre por defecto la interfaz del Inspector de Astur en vivo
- transmite capturas y actualizaciones del árbol semántico desde la sesión activa
- ordena las sugerencias de localizador a partir del árbol en caché, para una selección de baja latencia
- graba los toques sobre el espejo ejecutando primero un toque nativo por coordenadas y añadiendo después el mejor localizador semántico disponible
- graba el scroll con la rueda del ratón sobre el espejo como pasos `device.swipe(...)`
- permite cambiar de dispositivo desde la etiqueta del dispositivo actual en la cabecera, sin reiniciar `codegen`
- expone acciones de app y de dispositivo bajo el botón `Controls`
- permite instalar un APK subido, un `.app` de simulador o un `.ipa` de dispositivo real, lanzar una app ya instalada por identificador de paquete o bundle, conceder y revocar permisos, y borrar datos o caché de la app donde la plataforma lo permita
- exporta código de test en TypeScript o JavaScript usando la API de `@astur-mobile/test`

El espejo del dispositivo puede aparecer un instante antes de que se llene el árbol de interfaz. Las capturas en dispositivos reales, la inspección del árbol y las acciones nativas requieren un agente de iOS de Astur en buen estado y enlazado al bundle id de la app. Un `npx astur-mobile codegen --ios` a secas usa `com.astur.demo` como bundle id por defecto; pasa `--app-id` (o define `ASTUR_IOS_BUNDLE_ID`) para tu propia app. Pasa siempre un `.app` de simulador o un `.ipa` de dispositivo real con `--app` en la primera ejecución para que Astur pueda instalarlo: si solo indicas `--app-id` y la app no está instalada, Astur devuelve `IOS_APP_NOT_INSTALLED`. Para dispositivos reales, define `ASTUR_IOS_DEVELOPMENT_TEAM` para que Xcode pueda firmar el runner de XCUITest incluido, y asegúrate de que el llavero de firma de macOS esté desbloqueado. Cuando no se puede leer el árbol, el Inspector muestra el error de la plataforma en la zona de estado de la cabecera en lugar de dibujar un árbol vacío en silencio.

Opciones:

- `--android` o `--ios`
- `--platform android|ios`
- `--device <id>`
- `--app <ruta>`
- `--app-id <paquete-o-bundle-id>`
- `--ui` (por defecto)
- `--no-ui`
- `--no-launch`
- `--json`

## `screenshot`

Captura la pantalla de un dispositivo conectado en un PNG, sin escribir ningún test.

```bash
npx astur-mobile screenshot
npx astur-mobile screenshot -o inicio.png
npx astur-mobile screenshot --android --device emulator-5554
```

Acepta las mismas opciones de selección de dispositivo que `codegen`. No instala ni lanza nada: capturar una pantalla nunca debería cambiar lo que hay en ella.

## `inspect`

Alias de `codegen`.
