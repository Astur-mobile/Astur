---
title: "Flutter y React Native"
description: "Automatiza apps de Flutter y React Native con Astur: preparación, qué funciona y con qué límites contar."
sidebar:
  order: 9
---
Astur controla la **app real en un dispositivo o simulador real**, así que el framework de interfaz normalmente da igual: las apps nativas (Swift/Kotlin/Java/Obj-C), las de **React Native** y las de **Flutter** pasan todas por la misma API de `@astur-mobile/test`, el mismo Inspector y el mismo codegen.

La diferencia está en *cómo* se lee el árbol de la interfaz:

| Tipo de app | Android | iOS |
| --- | --- | --- |
| SDK nativo | agente UIAutomator | agente XCUITest |
| React Native | agente UIAutomator (vistas nativas) | agente XCUITest (vistas nativas) |
| Flutter | **servicio Dart VM** (árbol de widgets) | agente XCUITest (accesibilidad/semantics) |

## Qué frameworks funcionan

La regla es sencilla: **si el framework dibuja vistas nativas reales, Astur lo controla**, porque el árbol que lee es el de la propia plataforma y no hace falta nada específico del framework. Solo los frameworks que pintan sus propios píxeles necesitan un camino dedicado.

| Framework | Android | iOS | Notas |
| --- | --- | --- | --- |
| SDK nativo (Kotlin/Java, Swift/Obj-C) | Sí | Sí | La base con la que se compara todo lo demás |
| Jetpack Compose | Sí | — | Se dibuja como nodos de accesibilidad nativos |
| SwiftUI | — | Sí | Se corresponde con los `XCUIElementType` estándar |
| React Native | Sí | Sí | Componentes nativos reales; `testID` se convierte en el identificador nativo |
| Expo | Sí | Sí | Compila a React Native |
| Flutter | Sí | Sí | Renderizado propio, por eso tiene su propio camino: Dart VM en Android, árbol de semantics en iOS |
| .NET MAUI | Sí | Sí | Compila a controles nativos en ambas plataformas |
| NativeScript | Sí | Sí | Se dibuja con vistas nativas |
| Cordova / Capacitor / Ionic | Sí | Sí | La cáscara es nativa; al contenido web se llega con `device.webContext()` |
| Kotlin Multiplatform (interfaz compartida) | Sí | Sin verificar | La parte de Android es Compose normal; Compose Multiplatform en iOS no está probado |
| Unity y motores de juego | No compatible | No compatible | Una sola superficie de dibujo, sin árbol de elementos: no hay nada que localizar |

Salvo donde se indica lo contrario, no todas las filas se han probado contra una app real; el resto se deduce de que el framework dibuje vistas nativas, que es lo que realmente decide la respuesta.

## React Native

React Native dibuja **vistas nativas**, así que Astur lo automatiza exactamente igual que una app nativa: sin preparación extra, sin driver especial, en Android y en iOS.

- Añade la prop `testID` a los elementos que necesiten tus tests. React Native traduce `testID` al identificador de accesibilidad nativo (`resource-id` en Android, `accessibilityIdentifier` en iOS), que es lo que casa `getById()`.
- `getByText()` y `getByLabel()` casan con el texto visible y las etiquetas de accesibilidad.
- La automatización del **DOM de WebViews** internas funciona mediante `device.webContext()` — consulta [WebViews (DOM)](#webviews-dom) más abajo — en Android y en iOS (simulador y dispositivos reales) mediante `ios-webkit-debug-proxy`.

```tsx
// React Native — expone identificadores estables para los tests
<TextInput testID="login-email-input" ... />
<Pressable testID="login-submit-button" ... />
```

## Flutter

Flutter pinta sus propios píxeles en lugar de usar widgets nativos, así que en **Android** Astur se conecta al **servicio Dart VM** y lee el **árbol de widgets** en vivo — identificadores, texto, etiquetas, valores y límites — en lugar de depender solo de la capa de accesibilidad. Eso da inspección real a nivel de widget en el Inspector y en codegen.

### Cómo funciona (Android)

1. Astur detecta automáticamente un APK de Flutter (busca `libflutter.so` y `flutter_assets`).
2. Lanza la app con `flutter run --use-application-binary=<apk>`, que conecta el compilador de expresiones de Dart.
3. Lee el árbol de widgets en el dispositivo mediante el servicio VM y lo traduce a localizadores de Astur; los toques, rellenos y gestos se inyectan por ADB.
4. Entre tests se hace un hot restart de la app (y se vuelve a poner en primer plano) para partir de un estado limpio.

### Requisitos (Android)

- **Una build debug (o profile).** El servicio Dart VM solo existe en builds debug y profile: un APK `--release` no se puede manejar así.
- **`ASTUR_FLUTTER_PROJECT`** — la ruta al directorio **fuente** de la app Flutter (la carpeta con `pubspec.yaml`). Se usa como directorio de trabajo de `flutter run` para que el compilador de expresiones esté disponible.
- **La CLI de `flutter`** en el `PATH`, o **`ASTUR_FLUTTER_PATH`** apuntando al binario. Astur también busca en ubicaciones habituales (`~/development/flutter/bin`, `~/fvm/default/bin`, Homebrew, …).
- Opcional: **`ASTUR_FLUTTER=1`** fuerza el camino de Flutter y `ASTUR_FLUTTER=0` lo desactiva (si no, la detección es automática).

```bash
# Ejecutar una suite de Flutter (Android)
ASTUR_FLUTTER_PROJECT=/ruta/a/flutter-app \
  npx astur-mobile test --config ./config/android/playwright.flutter.config.ts

# Abrir el Inspector o codegen contra un APK de Flutter
ASTUR_FLUTTER_PROJECT=/ruta/a/flutter-app \
  npx astur-mobile codegen --android --device emulator-5554 \
  --app ./assets/app-debug.apk --app-id com.example.app
```

### Hacer que los widgets se puedan encontrar

Dale a los widgets que necesiten tus tests un **identificador de Semantics** estable. `getById()` casa con ese identificador; `getByText()` y `getByLabel()` casan con el contenido de `Text` y con las etiquetas semánticas.

```dart
// Flutter — expone un id estable para los tests
Semantics(
  identifier: 'login-email-input',
  child: TextField(controller: _email, decoration: const InputDecoration(hintText: 'pilot@astur.dev')),
)
```

Los campos de texto informan de un valor: el `controller.text` actual, o el `hintText` cuando están vacíos, así que `toHaveValue()` funciona igual que en nativo.

#### Qué tiene que aportar la app

Una app de Flutter solo es tan testeable como las semantics que expone. En la práctica, una pantalla necesita todo esto, no solo lo primero:

- **Un identificador en cada widget que un test toque o compruebe.** Envuélvelo en `Semantics(identifier: 'algun-id', child: …)`. Esto se traduce a `getById()` en Android *y* a `accessibilityIdentifier` en iOS, así que un mismo id sirve para ambos.
- **Una lectura identificada para todo lo que verifiques.** Flutter fusiona textos cercanos, así que una etiqueta y su valor a menudo colapsan en un solo nodo. Si un test necesita afirmar «el contador subió», dale al *valor* su propio id (`native-lab-lane-a-count`) en lugar de analizar una cadena fusionada.
- **Anclas identificadas alrededor de lo que deliberadamente no lleva id.** Si una pantalla incluye widgets sin id a propósito (para ejercitar `by.native()`), pon elementos con id justo antes y después, para que los tests puedan desplazar el grupo a la vista de forma determinista.
- **Un layout que no se reorganice al actuar sobre él.** Reserva espacio para contadores y lecturas desde el principio, en vez de insertar una fila en la primera interacción: un layout que se mueve invalida coordenadas y puede sacar un widget de la pantalla a mitad de test.
- **`container: true` en los envoltorios que quieras como nodos discretos**, o Flutter puede fusionarlos con el padre y el id desaparece del árbol.

```dart
// Una lectura sobre la que el test puede afirmar, con su propio id.
Semantics(
  identifier: 'home-tap-single-count',
  container: true,
  child: Text('$_tapCount'),
)
```

### Qué funciona (Android, servicio Dart VM)

- Instalar y lanzar, reinicio por hot restart, orientación, capturas
- Inspección del árbol de widgets anidado en el Inspector en vivo y en codegen
- `getById` (identificador de Semantics), `getByText`, `getByLabel`
- `tap`, `doubleTap`, `longPress`, `fill`, `swipe`
- Lectura del valor de campos de texto (`toHaveValue`)

### Flutter en iOS (árbol de accesibilidad de XCUITest)

iOS no tiene servicio Dart VM, así que Astur lee una app de Flutter mediante el **árbol de accesibilidad de XCUITest**, el mismo agente que se usa para nativo y React Native en iOS. La suite de demostración compartida se ejecuta en el simulador de iOS con **los 11 specs activos en verde** (login, formularios, deslizador, orientación y menú, swipe, tap-laboratory y los cinco specs de `by.native()`). Dos cosas hacen que funcione:

- **Añade `Semantics(identifier:)`** a los widgets que necesiten tus tests. Astur lee los ids, y lee valores de contadores y posición de deslizadores por id allí donde Flutter fusiona el texto de alrededor.
- Flutter **fusiona el texto descendiente en la etiqueta de accesibilidad del contenedor** en iOS, así que un `Text('Credentials')` no es un elemento discreto. El agente de iOS de Astur lo compensa con una coincidencia parcial sobre las etiquetas fusionadas, de modo que `getByText('Credentials')` sigue resolviendo; aun así, prefiere ids para todo lo que compruebes.

Excluido en iOS (límites documentados, no fallos):

- **arrastrar y soltar** — solo el *primer* arrastre sintético de XCUITest de una secuencia llega al reconocedor de pan de Flutter, así que un puzle de varias piezas no se puede resolver. (Sí pasa con el driver de Dart VM en Android, que inyecta eventos de movimiento reales).
- **subida de archivos** y **webview** — coinciden con las exclusiones de React Native en iOS (selector nativo; sin CDP para WKWebView — consulta [WebViews](#webviews-dom)).

### Escribir tests de Flutter fiables

Todo lo de abajo está medido contra la suite de demostración en un emulador Pixel 9. Son los modos de fallo que de verdad molestan, más o menos en orden de cuánto tiempo cuesta diagnosticarlos.

#### Desplaza con un arrastre, nunca con un impulso

**Esta es la mayor fuente de tests inestables en Flutter.** La física de scroll de Flutter reacciona a la *velocidad al soltar*, no a la distancia del gesto. El mismo deslizamiento sobre un tramo de 873 px se comporta de forma completamente distinta según `durationMs`:

| `durationMs` | Resultado en una página de altura completa |
| --- | --- |
| `300` | Se impulsa hasta el **final absoluto** del contenido |
| `600` | Se pasa bastante del objetivo |
| `1200`–`1400` | Arrastra de forma predecible unas 1,3 veces la distancia del gesto y se detiene |

Un bucle de búsqueda construido sobre deslizamientos rápidos no puede converger: se impulsa hasta abajo, detecta que se pasó, se impulsa hasta arriba y repite hasta agotar los intentos. En pantalla parece una app que sube y baja eternamente. Usa un arrastre lento (`durationMs: 1_200`) para cualquier deslizamiento cuya distancia necesites razonar. Los deslizamientos rápidos solo valen cuando quieres de verdad un impulso.

#### Solo existen los widgets en pantalla

El árbol de widgets contiene lo que está dispuesto **ahora mismo**. «Fuera de pantalla» no es `visible: false`: el nodo está *ausente*, y un localizador para él sencillamente nunca resuelve. Consecuencias:

- **Revela antes de leer**, siempre. No afirmes nada sobre un elemento al que no has desplazado la vista.
- **`scrollIntoView()` garantiza menos de lo que parece**: se detiene en cuanto el nodo entra en el árbol, lo que a menudo lo deja recortado por una barra inferior flotante — presente, pero inutilizable.
- **Ánclate en lo que necesitas, no en el contenedor.** Los límites de una tarjeta pueden estar dentro del viewport mientras un hijo suyo sigue ausente. Nombra los elementos que el test toca de verdad.
- **Encierra entre anclas los objetivos sin id.** Para garantizar que un elemento sin id está en pantalla, exige los elementos con id inmediatamente encima *y* debajo.
- **Deriva los márgenes de la interfaz, no de constantes en píxeles.** Lee los límites de la propia barra inferior en vez de reservar un número mágico; una constante ajustada a mano se desplaza mal en cualquier otra densidad.

#### Nunca mandes la app a segundo plano ni la fuerces a cerrarse a mitad de sesión

El driver mantiene un `flutter run` conectado a la Dart VM de la app, y el arranque entre tests es un **hot restart** sobre esa conexión. Por tanto:

- Matar el proceso destruye antes la VM a la que apunta el reinicio, y la reconexión se queda colgada hasta que `getVM` agota el tiempo.
- Pulsar HOME puede devolver el motor con una superficie de tamaño cero (`Width is zero. 0,0`), lo que tira abajo la conexión del servicio igualmente.

Reinicia una sesión de Flutter solo con un hot restart. Es el camino soportado y además el más rápido. (Astur se recupera reiniciando toda la sesión de `flutter run` si falla la reconexión, pero cuesta segundos que no hace falta gastar).

#### El layout debe ser estable durante una interacción

Si actuar sobre un widget cambia el layout, una coordenada capturada antes ya está obsoleta cuando la usas, y un elemento empujado fuera de pantalla desaparece del árbol. Prefiere manejar un **localizador** (`locator.tap()`), que se vuelve a resolver justo antes de actuar, a capturar `bounds()` una vez y reutilizar el punto.

#### `by.native()` en Flutter

`by.native()` se salta deliberadamente el árbol de widgets y resuelve mediante el agente de UiAutomator, que Astur conecta junto al servicio VM. De ahí se derivan dos cosas:

- **Flutter fusiona las etiquetas de los hijos de un contenedor en un solo `content-desc`.** Una fila informa `"Beta record\nChoose"`, así que cásala directamente con `descriptionContains`. **No** recurras a `hasDescendant`: UiAutomator recorre el subárbol entero por cada candidato, lo que contra un árbol de Flutter es lo bastante lento como para agotar el tiempo del comando, y se ha observado que arrastra consigo la conexión con la Dart VM.
- **Resolver y actuar son cosas separadas.** Astur resuelve mediante el agente pero actúa por la shell, porque un envoltorio `Semantics` de Flutter normalmente no es clicable por sí mismo: el nodo accionable queda fusionado debajo, así que un toque desde el agente o da error o se lo traga un contenedor.

#### Mantén sano el emulador

Los emuladores que llevan mucho tiempo en marcha se degradan de formas que se parecen exactamente a fallos del producto: tiempos agotados de `getVM`, `device offline` y `Width is zero. 0,0`. Si varios specs sin relación empiezan a fallar a la vez, reinicia el emulador antes de depurar el código: en esta suite eso solo devolvió un reproducible 12/14 a 14/14.

Además: **nunca ejecutes `adb shell uiautomator dump` mientras una suite está en marcha.** Abre su propia sesión de `UiAutomation` y desconecta el agente de Astur a mitad de test. `adb devices` y `logcat` son seguros; el volcado no.

### Observar el tráfico de red

`device.network` informa del tráfico HTTP de la app, útil para depurar qué llamó realmente una pantalla y para afirmar que llamó a lo correcto.

**Lee primero el límite de cobertura.** Astur informa del **tráfico instrumentado de la aplicación**, nunca de «todo el tráfico del dispositivo». Qué está instrumentado depende por completo del backend, así que pregunta en vez de suponer:

```ts
const capabilities = await device.network.capabilities();
// { observe, intercept, transports, responseBodies, coverage, adapterRequired }

test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.networkLab.getProfile();

const [request] = await device.network.requests({ url: '/api/profile' });
expect(request).toMatchObject({ method: 'GET', status: 200 });
```

| | Observar | Interceptar |
| --- | --- | --- |
| Flutter en Android | **Sí** — perfilador HTTP de Dart VM | necesita el adaptador en la app |
| Flutter en iOS (simulador) | **Sí** — perfilador HTTP de Dart VM | necesita el adaptador en la app |
| Flutter en iOS (dispositivo real) | No — el servicio VM no es alcanzable desde el host | necesita el adaptador en la app |
| React Native (Android + iOS) | **Sí** — dominio `Network` de CDP, build debug conectada a Metro | necesita el adaptador en la app |
| Nativo Android / iOS | No — no hay punto de enganche equivalente | necesita el adaptador en la app |

La observación en Flutter lee el servicio Dart VM, así que necesita una **build debug o profile**: una build release (AOT) no publica ninguno, en ninguna plataforma. En el simulador de iOS ese es el único requisito: Astur encuentra el servicio que la app ya anuncia y se conecta, sin cambiar cómo se instala, se lanza ni se maneja.

La observación en React Native lee el mismo dominio `Network` de CDP que usa React Native DevTools. El reportero vive en `ReactCommon`, la capa C++ compartida, así que un solo cliente cubre Android e iOS por igual, pero se excluye en compilación de las builds release, así que esto necesita una **build debug ejecutándose contra Metro**. La cobertura es el tráfico de `XMLHttpRequest`; en particular, **el `fetch` nativo de Expo es invisible**. Consulta [Observación de red](../network/#react-native-necesita-una-build-debug-sobre-metro) para la preparación y el límite completo.

La suite de ejemplo ejecuta el mismo spec compartido en ambos, así que la única diferencia es a qué build apunta:

```bash
npm run test:android:flutter    # build debug/profile de Flutter
npm run test:ios:flutter
npm run test:android:rn-debug   # build debug de React Native conectada a Metro
npm run test:ios:rn-debug
```

En Flutter la fuente es el perfilador HTTP de `dart:io` de la Dart VM, el mismo que usa la vista Network de Flutter DevTools. Eso cubre el `HttpClient` de `dart:io` y, por tanto, `package:http` y Dio, porque ambos se apoyan en él. **No** cubre las peticiones propias de una WebView, las llamadas de SDK nativos ni el tráfico por canales de plataforma. El soporte se detecta en tiempo de ejecución consultando las extensiones registradas del isolate, no se deduce de «esto es una app de Flutter».

Tres decisiones de diseño deliberadas que conviene conocer:

- **`requests()` lanza un error en lugar de devolver `[]`** cuando una sesión no puede observar (`NETWORK_OBSERVATION_UNSUPPORTED`). Una lista vacía tiene que significar «no hubo tráfico», o una aserción sobre ella pasaría por el motivo equivocado.
- **Las cabeceras con credenciales se ocultan por defecto**: `authorization`, `cookie`, `set-cookie` y `x-api-key` se convierten en `<redacted>` antes de devolver ningún registro, para que los secretos no lleguen a un log de CI ni a un informe HTML.
- **Los cuerpos de respuesta tienen tope** (64 KiB por defecto) y se descartan con `bodyOmittedReason: 'too-large'`. El perfilador conserva todo lo que captura durante la vida del isolate, así que una ejecución sin tope crecería sin límite. Astur activa el perfilado de forma perezosa en el primer uso y el fixture de test limpia el búfer entre tests, de modo que un test nunca puede afirmar sobre el tráfico de otro.

Ambos valores se pueden ajustar por llamada:

```ts
await device.network.requests({ url: '/api' }, { maxBodyBytes: 4096, redactHeaders: ['x-tenant'] });
```

**La interceptación todavía no está disponible.** `capabilities().intercept` es `false` en todas partes, y `adapterRequired` dice por qué: simular o hacer fallar una petición implica mantenerla abierta, y el perfilador no puede hacerlo — informa de lo que ya ocurrió. Eso necesita un pequeño adaptador opcional dentro de la app, que es la siguiente fase. Astur deliberadamente no incluye un proxy MITM para esto: Android 7+ ignora las CA instaladas por el usuario salvo que la app lo permita en `network_security_config`, y el `HttpClient` de Dart ignora por completo el proxy del sistema salvo que la app defina `findProxy`, así que un proxy exige cambios en la app *de todos modos*, y encima añade caducidades de certificado y fallos de TLS como formas nuevas de romper tests ajenos.

### Límites que conviene tener en cuenta

- **El driver del servicio Dart VM es solo para Android.** En **iOS**, Flutter se lee mediante el árbol de accesibilidad de XCUITest; consulta [Flutter en iOS](#flutter-on-ios-xcuitest-accessibility-tree) más arriba para saber qué funciona hoy y qué queda excluido.
- **Se necesita una build debug o profile** (no hay servicio VM en las builds release).
- **`ASTUR_FLUTTER_PROJECT` es obligatorio**: Astur necesita el código fuente de Flutter para conectar el compilador de expresiones; apuntar solo al APK no basta.
- **Solo elementos en pantalla.** Igual que el árbol de accesibilidad de iOS, el árbol de widgets expone lo que está dispuesto en pantalla en ese momento: desplaza el objetivo a la vista antes de leerlo o comprobarlo.
- **La interfaz nativa fuera de Flutter no es visible para el servicio VM.** Los diálogos de permisos del sistema, el selector nativo de fotos o archivos y las hojas de compartir son ajenos a la vista de Flutter, así que un `getBy*` contra el árbol de Flutter no los encontrará. Interactúa con ellos por coordenadas o manéjalos por el camino del agente nativo.
- **Los gestos sintéticos sobre widgets de pan personalizados pueden ser imprecisos.** Un arrastre fino sobre un `GestureDetector` o `Listener` propio puede no caer exacto; prefiere toques y rellenos estables y mantén los objetivos arrastrables fuera de vistas de scroll que compitan.
- **Los APK debug de Flutter son grandes.** Una build debug lleva el kernel JIT (`kernel_blob.bin`), el motor de depuración y una capa de validación de Vulkan, así que no va a ser pequeña; aun así, el conjunto de ABI la duplica aproximadamente. Medido en la app de demostración: **154 MB** con todas las ABI frente a **86 MB** con `--target-platform android-arm64`. Ojo: la opción **se ignora en una compilación incremental**; ejecuta `flutter clean` primero o Gradle reutilizará el APK anterior y parecerá que la opción no hace nada.
- **El almacenamiento del emulador es un espacio distinto del disco del host.** Un `INSTALL_FAILED_INSUFFICIENT_STORAGE` normalmente significa que la partición de datos del AVD está llena, no que el APK sea demasiado grande. Borra los datos del emulador (lo que además recupera espacio en el host, porque el qcow2 se encoge) antes de ponerte a adelgazar el artefacto.

## WebViews (DOM)

> ¿Estás probando un **sitio web** en el navegador del propio dispositivo en lugar de una WebView dentro de tu app? Eso es `device.browser`; consulta [Web móvil](../mobile-web/). Por debajo son la misma maquinaria; el navegador añade el destino y la navegación.

Las apps híbridas incrustan una WebView cuyo DOM es invisible para el árbol de accesibilidad nativo. `device.webContext()` abre ese DOM y lo maneja con **localizadores web estables**, con la misma ergonomía que la API nativa:

```ts
const web = await device.webContext();
await web.getByTestId('astur-submit').tap();
await web.getById('astur-email').fill('qa@astur.dev');
const status = await web.getById('astur-result').textContent();
const tree = await web.snapshot(); // árbol DOM completo con mejores localizadores y límites
```

Es **independiente del motor por diseño**: todas las consultas, la generación de localizadores y la interacción se ejecutan *dentro de la página* mediante un puente inyectado sobre un único transporte `evaluate(js) → JSON`, así que el comportamiento es idéntico para **Flutter y React Native**. Los mejores localizadores se ordenan `getByTestId` › `getById` › `getByRole` › `getByText` › CSS. El **Inspector** muestra ese mismo árbol DOM insertado bajo el nodo nativo que aloja la WebView, con relleno y toque sobre elementos web.

Transporte por plataforma:

| Plataforma | Transporte | Estado |
| --- | --- | --- |
| Android (Flutter y RN) | WebView de Chromium · Chrome DevTools Protocol | **Funciona** — activa `setWebContentsDebuggingEnabled(true)` (`WebView.enableDebugging` en Android o builds debug de RN) |
| Dispositivo iOS real | WKWebView · RWI de WebKit vía `ios-webkit-debug-proxy` | **Funciona** — `WKWebView.isInspectable = true` (iOS 16.4+), Ajustes ▸ Safari ▸ Avanzado ▸ Inspector web, y `brew install ios-webkit-debug-proxy` |
| Simulador de iOS | WKWebView · `webinspectord_sim` | **Funciona** — requiere `WKWebView.isInspectable = true` (iOS 16.4+) y `brew install ios-webkit-debug-proxy`. Astur localiza el socket del simulador y lo maneja con el modo `-s` de iwdp automáticamente, sin nada más |

Consulta [Límites de plataforma](../platform-limits/) para la referencia completa de fronteras entre Android e iOS, y [Inspector y codegen](../inspector/) para el ciclo de escritura en vivo.
