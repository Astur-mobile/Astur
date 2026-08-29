# Requisitos previos

Astur evita deliberadamente el servidor Appium, pero sigue apoyándose en las herramientas nativas que exponen Android e iOS.

## Compatibilidad del equipo anfitrión

| SO anfitrión | Emulador/dispositivo Android | Simulador de iOS | Dispositivo iOS real |
| --- | --- | --- | --- |
| macOS | Sí | Sí | Sí |
| Linux | Sí | No | Sin soporte local |
| Windows | Sí | No | Sin soporte local |

La automatización local de iOS necesita macOS porque el simulador de Apple, Xcode, `xcrun`, `simctl`, `xcodebuild` y XCTest solo existen en macOS.

## Necesario para todo el mundo

- Node.js 18 o superior
- npm 9 o superior
- Playwright Test, instalado mediante `@astur-mobile/test`
- Una terminal con acceso a las herramientas de plataforma en el `PATH`

Comprueba:

```bash
node --version
npm --version
npx astur-mobile doctor
```

## Necesario para Android

- Android SDK
- Android SDK Platform Tools
- `adb` en el `PATH`
- Al menos un emulador de Android o un dispositivo Android conectado por USB
- Depuración USB activada en los dispositivos reales

Variables de entorno recomendadas:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

En Linux y Windows, ajusta las rutas a la ubicación de tu Android SDK.

Verifica:

```bash
adb version
adb devices -l
npx astur-mobile devices --android
```

## Necesario para iOS

iOS solo funciona en macOS. Elige la columna que corresponda a tu objetivo: el camino del simulador **no necesita firma de Apple**, el de dispositivo real sí.

| Requisito | Simulador de iOS | iPhone / iPad real |
| --- | :---: | :---: |
| macOS y Xcode (abierto al menos una vez, licencia aceptada) | Obligatorio | Obligatorio |
| Herramientas de línea de comandos de Xcode (`xcrun`, `simctl`, `xcodebuild`) | Obligatorio | Obligatorio |
| **Runtime de simulador** de iOS instalado desde Xcode | Obligatorio | — |
| `devicectl` (viene con Xcode) | — | Obligatorio |
| Artefacto de la app | **`.app`** compilado para simulador | **`.ipa`** firmado para el dispositivo |
| **Equipo de firma** de Apple (`ASTUR_IOS_DEVELOPMENT_TEAM`) | No hace falta | **Obligatorio** |
| Dispositivo de confianza con **Modo Desarrollador** activado | — | Obligatorio |
| Agente XCUITest incluido | Astur lo compila y lo arranca | Astur lo compila, lo **firma** y lo arranca |

> El agente nunca se instala a mano. Astur compila y lanza el runner de XCUITest en Swift incluido, mediante Xcode, en cada sesión. En dispositivos reales lo firma además con tu equipo: la única pieza de configuración que los simuladores se ahorran.

Verifica la cadena de herramientas:

```bash
xcodebuild -version
xcrun simctl list devices available   # simuladores
xcrun devicectl list devices          # dispositivos reales
npx astur-mobile devices --ios
npx astur-mobile doctor --verbose
```

Elige el camino de iOS que realmente necesitas antes de configurar de más:

| Objetivo | ¿Hay que compilar tu app antes? | Artefacto que espera Astur | ¿Firma de Apple? | Ejemplo con el repositorio actual |
| --- | --- | --- | --- | --- |
| Abrir el Inspector o codegen en un simulador y validar la cadena de herramientas de iOS | No (descarga la `.app` de demostración) | `Astur.app` | No | `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo` |
| Ejecutar tu propia app en un simulador | Sí | `.app` compilada para simulador | No | Define `app.path` en tu configuración y ejecuta `npx astur-mobile test` |
| Ejecutar en un iPhone o iPad real | Sí | `.ipa` firmada para el dispositivo | Sí. Define `ASTUR_IOS_DEVELOPMENT_TEAM` y usa una app firmada para ese dispositivo. | `npx astur-mobile codegen --ios --real --device <udid> --app ./MyApp.ipa --app-id com.example.myapp` |

> La app de demostración que se menciona arriba (`Astur.app` / `astur.demo.ios.ipa`, bundle id `com.astur.demo`) está en el repositorio de ejemplos de Astur, y viene bien para una primera ejecución antes de montar tu propia compilación.

La diferencia importante de artefacto es simple: el simulador de iOS usa `.app` y los dispositivos iOS reales usan `.ipa`.

No necesitas un servidor Appium aparte, ni una extensión de WebDriver, ni un runner de XCTest instalado a mano. Astur incluye el agente XCUITest en Swift y lo arranca con Xcode cuando hace falta.

Si ejecutas solo con `--app-id` y la app no está, Astur falla de inmediato con `IOS_APP_NOT_INSTALLED`. Para la primera ejecución, pasa `--app /ruta/a/TuApp.app` en simulador o `--app /ruta/a/TuApp.ipa` en dispositivo real, para que Astur pueda instalarla antes de conectarse.

El agente de iOS de Astur no se instala manualmente. Astur arranca automáticamente el agente XCUITest incluido, tanto en sesiones de simulador como de dispositivo real.

Para dispositivos iOS reales, configura además:

- una cuenta de Apple Developer en Xcode
- un iPhone o iPad de confianza conectado por USB
- el Modo Desarrollador activado en el dispositivo
- la app firmada para ese dispositivo físico
- `ASTUR_IOS_DEVELOPMENT_TEAM` con el identificador de tu equipo de Apple

Entorno recomendado para dispositivo real:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
# Opcional: defínelo solo si el teléfono no alcanza el puente que Astur detecta automáticamente.
export ASTUR_IOS_AGENT_HOST=192.168.0.14
```

Los simuladores no necesitan `ASTUR_IOS_DEVELOPMENT_TEAM` ni un certificado de Apple Development.

Astur firma y arranca el runner de XCUITest incluido de forma automática, pero Apple exige que el equipo de firma venga de tu máquina o de un secreto de CI. Si trabajas desde el repositorio fuente, Astur puede deducir el equipo de `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` cuando el proyecto ya está firmado en Xcode. Para instalaciones desde npm y para CI, define `ASTUR_IOS_DEVELOPMENT_TEAM`.

Los dispositivos reales conectados por USB se comunican normalmente por el túnel CoreDevice de Xcode. Deja `ASTUR_IOS_AGENT_HOST` sin definir salvo que necesites expresamente que el teléfono conecte con una dirección de red concreta del Mac.

### DOM de WebViews en iOS (opcional)

Solo hace falta si manejas el **DOM** de una WebView (`device.webContext()` o `webview()`) en iOS. Los localizadores nativos sobre pantallas con WebView no necesitan nada de esto.

- `brew install ios-webkit-debug-proxy` (v1.9+ — el soporte de simulador usa su modo `-s`)
- que la app defina `WKWebView.isInspectable = true` (iOS/iPadOS 16.4+)
- solo en dispositivos reales: Ajustes ▸ Safari ▸ Avanzado ▸ Inspector web activado

Funciona tanto en el simulador de iOS como en dispositivos reales; Astur localiza automáticamente el socket del Web Inspector del simulador.

## Necesario para Flutter

Astur automatiza apps de Flutter sin Appium y sin un driver de terceros específico de Flutter.

- **Flutter en Android** — apunta tu configuración a un APK de Flutter en **debug** (o profile); las compilaciones release no tienen servicio Dart VM y no se pueden manejar. Necesita además la CLI de `flutter` en el `PATH` (o `ASTUR_FLUTTER_PATH`) y `ASTUR_FLUTTER_PROJECT` apuntando al directorio fuente de la app (la carpeta con `pubspec.yaml`).
- **Flutter en iOS** — se lee a través del árbol de accesibilidad de XCUITest (sin servicio Dart VM); usa un `Runner.app` compilado para simulador y activa las semantics para que se expongan identificadores y etiquetas.
- Da a los widgets un `Semantics(identifier: 'login-email-input')` estable para que `getById()` los resuelva; `getByText` y `getByLabel` coinciden con `Text` y con las etiquetas.

Consulta [Flutter y React Native](../frameworks/) para la guía completa y [Límites de plataforma](../platform-limits/) para lo que excluye cada plataforma.

## Límites de la beta actual

- La automatización nativa de Android usa por defecto el agente UIAutomator en Kotlin incluido para buscar localizadores, esperar, ejecutar acciones y gestos, controlar el teclado e inspeccionar el árbol de interfaz.
- Android sigue usando ADB para tareas de ciclo de vida como descubrimiento, instalación, arranque, captura de logs, capturas de pantalla, vídeo y redirección de puertos.
- El camino alternativo heredado de ADB con XML de UIAutomator sigue disponible durante la migración, pero no es la vía preferente.
- La automatización del DOM en WebViews internas de Android funciona mediante el Chrome DevTools Protocol cuando la app activa la depuración de WebView (`setWebContentsDebuggingEnabled(true)`).
- La automatización de elementos nativos en simulador y dispositivo real de iOS funciona mediante el agente XCUITest en Swift incluido.
- Los simuladores de iOS usan `simctl` para las tareas de ciclo de vida; los dispositivos reales usan `devicectl`.
- Los dispositivos iOS reales requieren firmar el runner de XCUITest con `ASTUR_IOS_DEVELOPMENT_TEAM`.
- Los permisos en iOS real, el borrado directo de datos o caché, el bloqueo y desbloqueo y la grabación de vídeo siguen limitados por las herramientas públicas de Apple. Usa el reinicio por reinstalación y las capturas donde esas API no existan. Si se activa el vídeo nativo en una ejecución sobre iOS real, Astur adjunta una nota de vídeo omitido en lugar de fallar el test.
- La automatización del DOM en WebView (WKWebView) de iOS funciona en el **simulador y en dispositivos reales** mediante `ios-webkit-debug-proxy` (v1.9+) y `WKWebView.isInspectable = true` (iOS 16.4+). Los localizadores nativos también funcionan en pantallas con WebView.

## Requisitos opcionales del endpoint del agente nativo

Astur arranca sus agentes nativos automáticamente en las ejecuciones locales normales. Solo necesitas un endpoint explícito cuando te conectas a un agente arrancado por separado o cuando estás diagnosticando el comportamiento del transporte.

- un endpoint de agente alcanzable para tu plataforma de destino
- el agente correspondiente escuchando en ese endpoint (endpoint `android` para sesiones de Android, endpoint `ios` para sesiones de iOS)
- valores de tiempo de espera adecuados a tu entorno, si sobrescribes los de por defecto

Variables de entorno habituales:

```bash
export ASTUR_ANDROID_AGENT_ENDPOINT=tcp:127.0.0.1:8787
export ASTUR_IOS_AGENT_ENDPOINT=http://127.0.0.1:8788
```

La política por defecto es «primero el agente» en ambas plataformas:

- Android: `automation.engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`, `startupTimeoutMs: 30_000`, `commandTimeoutMs: 20_000`.
- iOS: `automation.engine: 'agent'`, `agent.mode: 'required'`, `legacyFallback: 'never'`, `startupTimeoutMs: 60_000`, `commandTimeoutMs: 15_000`.

Vuelve al camino heredado de ADB/UIAutomator en Android con `automation.engine: 'auto'` (que activa `legacyFallback: 'on-agent-failure'`). Puedes seguir sobrescribiendo estos valores en `use.astur.automation` o `use.astur.agent`, pero la mayoría de proyectos deberían omitirlos.
