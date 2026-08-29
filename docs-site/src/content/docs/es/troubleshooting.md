---
title: "Resolución de problemas"
description: "Diagnostica problemas de dispositivo, app, agente, Inspector y ejecución de tests."
sidebar:
  order: 7
---
Empieza por:

```bash
npx astur-mobile doctor
```

Usa el modo detallado cuando falle un comando:

```bash
npx astur-mobile doctor --verbose
```

## No se encuentra ADB

Síntoma:

```text
ADB failed
```

Solución:

- instala las Android SDK Platform Tools
- añade `platform-tools` al `PATH`

```bash
adb version
```

## No se detecta ningún dispositivo Android

Síntoma:

```text
Android devices: No Android devices detected.
```

Solución:

- arranca un emulador
- conecta un dispositivo real
- activa la depuración USB
- acepta el aviso de depuración USB

Comprueba:

```bash
adb devices -l
```

## El dispositivo Android está sin autorizar

Síntoma:

```text
unauthorized
```

Solución:

- desbloquea el teléfono
- acepta el aviso de depuración USB
- vuelve a conectar el cable
- ejecuta `adb kill-server && adb start-server`

## Falla la deducción de metadatos en Android

Síntoma:

```text
AAPT_NOT_FOUND
```

Solución:

- asegúrate de tener instaladas las build tools del Android SDK
- define `ANDROID_HOME` o `ANDROID_SDK_ROOT`
- define `ASTUR_AAPT` con la ruta completa de `aapt`

O indica los metadatos a mano:

```ts
app: {
  path: './apps/demo.apk',
  packageName: 'com.example',
  activity: '.MainActivity'
}
```

## El arranque en Android necesita el nombre de paquete

Síntoma:

```text
Android launch requires app.packageName.
```

Corrige la configuración indicando `packageName`, o asegúrate de que `aapt` esté disponible para que Astur pueda deducirlo del APK.

## No se encuentra Xcode

Síntoma:

```text
Xcode failed
```

Solución:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
```

## No hay simuladores de iOS

Síntoma:

```text
iOS simulators: No iOS simulators were found.
```

Solución:

- abre Xcode
- instala un runtime de simulador de iOS desde Ajustes > Plataformas

Comprueba:

```bash
xcrun simctl list devices available
```

## Las acciones nativas de iOS requieren el agente XCUITest

Síntoma:

```text
XCTEST_AGENT_REQUIRED
```

Los comandos de ciclo de vida y las capturas en iOS pueden funcionar mediante `simctl`, pero la búsqueda de elementos nativos y los gestos requieren el agente XCUITest en Swift.

Solución:

- pasa el bundle id de la app al arrancar codegen o los tests: `--app-id com.example.demo`
- o define `ASTUR_IOS_BUNDLE_ID=com.example.demo`
- en el Inspector, usa `Controls` > App para lanzar por bundle id; eso reenlaza el agente XCUITest a esa app
- ejecuta `npx astur-mobile doctor --verbose` si falla la compilación de Xcode o el registro del agente

Para la app de demostración incluida, codegen usa `com.astur.demo` por defecto.

## El agente XCUITest de iOS no arranca

Síntoma:

```text
IOS_XCTEST_AGENT_START_FAILED
```

Astur arranca el runner de XCUITest incluido para automatizar el simulador y espera a que se registre en el puente del host. El driver reintenta el arranque por defecto e incluye la salida reciente de `xcodebuild` en los metadatos del error cuando el registro sigue fallando.

Solución:

- confirma que el simulador elegido está arrancado: `xcrun simctl list devices booted`
- confirma que el bundle id de la app está instalado, o indica `app.path` junto con `app.bundleId`
- vuelve a ejecutar el mismo comando una vez más tras un arranque en frío de Xcode; reutilizar la ruta de DerivedData hace más rápido el segundo intento
- aumenta `agent.launchTimeout` solo cuando el equipo sea legítimamente lento
- define `ASTUR_IOS_AGENT_START_ATTEMPTS=3` en entornos de CI inestables, si a veces los servicios del simulador no consiguen lanzar XCTest al primer intento

## El dispositivo iOS real necesita equipo de firma

Síntoma:

```text
IOS_DEVELOPMENT_TEAM_REQUIRED
```

Astur encontró el iPhone físico e intentó arrancar el runner de XCUITest incluido, pero Xcode no pudo firmarlo.

Solución:

- añade tu cuenta de Apple Developer en Xcode
- desbloquea el iPhone conectado y márcalo como de confianza
- activa el Modo Desarrollador en el dispositivo
- define `ASTUR_IOS_DEVELOPMENT_TEAM=<id del equipo>`
- asegúrate de que el IPA de la app también esté firmado para ese dispositivo

Si trabajas desde el repositorio fuente, seleccionar un equipo en `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` basta para las ejecuciones locales, porque Astur puede deducirlo. Las instalaciones publicadas desde npm y los entornos de CI deberían definir `ASTUR_IOS_DEVELOPMENT_TEAM` explícitamente.

Los detalles del error incluyen la salida reciente de `xcodebuild`, para que en los logs de CI se vea exactamente qué destino falló al firmar.

## La firma de la app de iOS no es de confianza

Síntoma:

```text
IOS_APP_SIGNATURE_NOT_TRUSTED
```

o:

```text
IOS_APP_INSTALL_SIGNATURE_INVALID
```

o el iPhone muestra:

```text
Astur is no longer available
```

El runner de XCUITest de Astur arrancó, pero iOS se negó a lanzar la app bajo prueba. O bien, cuando se indica `--app` o `app.path`, iOS se negó a instalar el IPA antes de que arrancara el runner. Es un problema de firma, aprovisionamiento o confianza de la app, no de dibujado del Inspector.

Solución:

- instala un IPA firmado para el UDID del dispositivo conectado
- vuelve a compilar o a firmar el IPA si la salida de la instalación dice que el perfil de aprovisionamiento ha caducado
- marca el perfil de desarrollador como de confianza en el iPhone cuando iOS lo pida
- mantén el bundle id de la app alineado con `--app-id` / `app.bundleId`
- pasa `--app <ruta-al-ipa-firmado>` a codegen para que Astur actualice la app instalada antes de conectarse
- si la app se firmó con otro equipo o perfil, desinstálala del dispositivo y vuelve a ejecutar codegen

Para codegen, Astur fuerza una vez la instalación de la ruta de app de iOS indicada antes de arrancar el runner de XCUITest. Las ejecuciones normales de tests mantienen el comportamiento por defecto, más rápido, y se saltan la reinstalación cuando el bundle id ya está instalado.

## El llavero del Mac está bloqueado (dispositivo iOS real)

Síntoma:

```text
IOS_SIGNING_KEYCHAIN_LOCKED
```

o la terminal imprime repetidamente:

```text
Password:
```

Xcode está intentando acceder al certificado de firma de Apple Development para el runner de XCUITest incluido, pero macOS está pidiendo permiso para el llavero.

Solución:

- desbloquea el llavero de inicio de sesión antes de arrancar Astur
- en Acceso a Llaveros, permite que codesign y Xcode accedan al certificado de Apple Development cuando lo pida
- evita ejecutar el Inspector en una terminal que está esperando un aviso interactivo de firma
- en CI, importa el certificado de firma en un llavero temporal desbloqueado antes de ejecutar Astur

Astur arranca el agente de dispositivo real en un grupo de procesos aislado, para que los avisos de firma no se queden con la terminal del Inspector. Si aun así la firma no puede continuar, Astur informa `IOS_SIGNING_KEYCHAIN_LOCKED` con la salida reciente de `xcodebuild`.

## El puente del dispositivo iOS real no consigue registrarse

Síntoma:

```text
IOS_XCTEST_AGENT_START_FAILED
```

con una salida que muestra que el runner de XCUITest arrancó pero no se registró en el puente de Astur.

Solución:

- mantén el teléfono desbloqueado durante el arranque
- permite conexiones entrantes si el cortafuegos de macOS pregunta por Node.js
- mantén el dispositivo conectado por USB para que Astur pueda usar el túnel de Xcode/CoreDevice
- deja de definir `ASTUR_IOS_AGENT_HOST` si está forzando al teléfono por una ruta de red local bloqueada
- define `ASTUR_IOS_AGENT_HOST` con una IP del Mac solo cuando esa dirección sea alcanzable desde el teléfono
- evita VPN o aislamiento de red entre el Mac y el dispositivo cuando uses un puente por LAN
- aumenta `agent.launchTimeout` solo después de confirmar que el host del puente es alcanzable

Si la salida de `xcodebuild` incluye `NSURLErrorDomain Code=-1009` o `Local network prohibited`, el agente arrancó pero iOS bloqueó la ruta de red. El transporte por USB/CoreDevice es la solución preferente; forzar una dirección Wi-Fi puede exigir permisos de red local y cambios en el cortafuegos.

## El Inspector nunca llega a estar listo

Síntoma:

```text
Inspector is not ready yet   (el indicador no para; la etiqueta se queda en «Connecting…»)
```

La pestaña del navegador se abre, pero el espejo del dispositivo no aparece nunca y el árbol de interfaz sigue vacío.

Comprueba en este orden:

- **Pestaña equivocada o antigua.** Cada ejecución de `codegen` imprime una línea nueva `ui  live  http://localhost:<puerto>` y abre una pestaña nueva. Una pestaña que quedó abierta de una ejecución anterior apunta a un puerto muerto y muestra «Connecting…» para siempre. Cierra las pestañas viejas y abre la URL de la ejecución **actual**.
- **Una ejecución anterior sigue reteniendo el dispositivo.** Astur limpia automáticamente las sesiones de agente que quedaron para el mismo dispositivo antes de arrancar una nueva. Si lo desactivaste con `ASTUR_IOS_AGENT_REAP=0`, mata los restos a mano:

  ```bash
  pkill -f "xcodebuild.*AsturIOSAgent"
  ```

- **Confirma que el agente está atendiendo comandos.** Vuelve a ejecutar con la traza del puente; deberías ver líneas `response-ok tree.get` y `response-ok device.screenshot`:

  ```bash
  ASTUR_IOS_AGENT_TRACE=1 npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
  ```

  Si los comandos se entregan pero nunca reciben respuesta, lo más probable es que la app bajo prueba esté atascada sin quedar en reposo (una animación o vídeo en bucle) — consulta [Rendimiento y estabilidad en iOS](../ios/).
- **¿Sigue sin funcionar?** Asegúrate de estar en la compilación actual (`npm run build` si trabajas desde el código fuente) y recarga la pestaña forzando el refresco.

## El árbol del Inspector está vacío en iOS

Síntoma:

```text
UI tree unavailable
```

La captura reflejada se ve, pero el panel del árbol de interfaz está vacío.

Solución:

- asegúrate de que el simulador está arrancado y la app instalada
- indica el bundle id con `--app-id`, `ASTUR_IOS_BUNDLE_ID` o desde `Controls` en el Inspector
- mantén disponible el proyecto `agents/ios-xctest-agent` si trabajas desde el código fuente
- aumenta `agent.launchTimeout` si Xcode está arrancando en frío el runner de tests por primera vez

## Falta el endpoint en modo de agente obligatorio (Android)

Síntoma:

```text
ANDROID_AGENT_ENDPOINT_REQUIRED
```

Solución:

- define `use.astur.agent.endpoint`
- o define `ASTUR_ANDROID_AGENT_ENDPOINT`
- o cambia a `agent.mode: 'auto'` durante la migración

## Falta el endpoint en modo de agente obligatorio (iOS)

Síntoma:

```text
IOS_XCTEST_AGENT_ENDPOINT_REQUIRED
```

Solución:

- define `use.astur.agent.endpoint`
- o define `ASTUR_IOS_AGENT_ENDPOINT`
- o cambia a `agent.mode: 'auto'` durante la migración

## Falla el saludo inicial del agente en modo obligatorio

Síntoma:

```text
ANDROID_AGENT_CONNECT_FAILED
```

o

```text
IOS_XCTEST_AGENT_CONNECT_FAILED
```

Solución:

- verifica la URL y el puerto del endpoint
- verifica que la plataforma del endpoint coincide con la de la sesión actual
- verifica que el endpoint acepta envolturas de comando por HTTP POST
- aumenta `agent.launchTimeout` en entornos de arranque lento

## Falla un comando del agente en modo obligatorio

Síntoma:

```text
ANDROID_AGENT_COMMAND_FAILED
```

o

```text
IOS_XCTEST_AGENT_COMMAND_FAILED
```

Solución:

- valida el comando de destino en la implementación del agente en el dispositivo
- confirma que los datos de selector y acción coinciden con el esquema esperado por el agente
- revisa los logs del agente en el servidor para ver fallos a nivel de comando
- ejecuta temporalmente en `agent.mode: 'auto'` mientras diagnosticas la cobertura de comandos del endpoint

## iOS se omite en Linux y Windows

Síntoma:

```text
SKIP iOS platform
```

Es lo correcto. La automatización local de iOS necesita macOS con Xcode.
