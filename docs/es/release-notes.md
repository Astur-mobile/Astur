# Notas de versión

Qué trae cada versión de Astur.

## 0.6.0-beta

**Prueba un sitio web en el navegador del propio dispositivo.** `device.browser` maneja Chrome en Android y Safari en iOS, en el mismo emulador, simulador o dispositivo real donde ya corre tu suite nativa — así que un sitio adaptable y una app nativa se cubren en una misma ejecución y un mismo informe.

```ts
const page = await device.browser.open('https://example.com/pricing');
await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
await page.getByTestId('plan-pro').tap();
```

Incluye `open`, `navigate`, `reload`, `back`, `forward`, `url` y `capabilities`; esta última responde en todas las plataformas, así que un spec puede saltarse a sí mismo con `test.skip()` indicando el motivo, igual que ya permite `device.network`. Cada navegación devuelve el `WebContext` vivo, el mismo objeto que da `device.webContext()`, de modo que todos los localizadores y acciones funcionan sin cambios.

Define `browser` en lugar de `app` y la sesión pasa a ser **solo de navegador**: sin instalación de app, y con el agente nativo como opcional en vez de obligatorio. En iOS eso es la diferencia entre abrir una página y necesitar antes una identidad de firma.

Playwright ya prueba muy bien la web móvil mediante emulación de dispositivos, y es más rápido en CI. Esto es para cuando la emulación no es lo que necesitas: un navegador móvil real, en el mismo conjunto de dispositivos, en el mismo informe que la suite nativa.

Tres problemas hubo que resolver más allá del transporte del DOM que ya existía:

- **Una pestaña por test, cerrada al terminar**, como Playwright da una página a cada test. Android crea y cierra pestañas por el socket de depuración. WebKit no expone el ciclo de vida de las pestañas, así que iOS reutiliza una y la recarga — y `open()` siempre carga aunque la pestaña ya muestre esa URL, porque una pestaña reutilizada conserva el DOM del test anterior.
- **Estabilizar sobre el documento, no sobre la URL.** Una recarga deja la URL idéntica, así que una espera basada en la URL vuelve al instante y te entrega la página *antigua*. Astur planta un testigo en `window` y espera a que desaparezca, que es exactamente cuando se sustituye el documento.
- **Detección del primer arranque.** Chrome no publica socket de depuración hasta completar su asistente de bienvenida, así que un emulador nuevo esperaría eternamente por una página que nunca llega. Se informa como `BROWSER_FIRST_RUN_PENDING` en vez de agotar el tiempo.

### Límites

Conviene leerlos antes de montar una suite sobre esto. Ninguno es un fallo: es lo que exponen las plataformas.

| Límite | Afecta a |
| --- | --- |
| Una pestaña **no** es un *browser context* de Playwright: las cookies y `localStorage` se comparten en el perfil | Ambas |
| Sin aislamiento de pestañas en iOS; WebKit no expone su ciclo de vida | iOS |
| La interfaz del navegador es nativa, no forma parte de la página | Ambas |
| No hay cambio de pestaña ni varias ventanas | Ambas |
| Chrome debe haber pasado su pantalla de primer arranque | Android |
| Los dispositivos iOS reales están escritos pero sin verificar en hardware | Dispositivo iOS real |

**La documentación está ahora en árabe**, en [/ar/](https://astur-mobile.github.io/Astur/ar/), con los nombres de API y protocolos en inglés tal cual.

### Corregido

- **La WebView de una app podía manejarse a través del navegador.** Android nombra los sockets `webview_devtools_remote_<pid>` y `chrome_devtools_remote`, y se ordenan alfabéticamente, así que con Chrome abierto `device.webContext()` se conectaba al navegador en lugar de a la app bajo prueba. Ahora los sockets se ordenan según lo que pidió quien llama.

Todo el detalle en el [changelog](https://github.com/Astur-mobile/Astur/blob/main/CHANGELOG.md).

## 0.5.0-beta.5

**Compara capturas de pantalla.** `toHaveScreenshot()` contrasta un elemento o la pantalla entera con una imagen de referencia guardada, de modo que un cambio visual falla un test en vez de colarse. El matcher propio de Playwright necesita un `Page`; este es el equivalente nativo.

```ts
await expect(app.home.heroCard).toHaveScreenshot('hero-card.png');
await expect(device).toHaveScreenshot('home.png', { mask: [device.getById('clock')] });
```

Las referencias se guardan por plataforma, motor de renderizado y tamaño de pantalla. `mask` tapa lo que puede cambiar. `threshold`, `maxDiffPixels` y `maxDiffPixelRatio` fijan la tolerancia. Un fallo se muestra como una comparación de imágenes en condiciones dentro del informe HTML, con las pestañas Diff / Actual / Expected / Slider.

**Observación de red en React Native**, en Android e iOS. `device.network` lee ahora el dominio `Network` de CDP que usa React Native DevTools. El reportero vive en `ReactCommon`, así que una sola implementación cubre ambas plataformas.

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);
```

Dos límites, ambos medidos y no supuestos: necesita una **build debug conectada a Metro** (el reportero se excluye de las builds release) y ve el tráfico de **`XMLHttpRequest`** — incluidos el polyfill de `fetch` de React Native y axios, pero *no* el `fetch` nativo de Expo, que se salta por completo la capa de red de React Native.

**Observación de red en simuladores de iOS con Flutter**, con la misma cobertura y ocultación de datos que en Flutter sobre Android. No cambia nada de cómo se instala o se maneja la app.

### Corregido

- **`--update-snapshots` solo funcionaba como `--update-snapshots=all`.** Un `-u` a secas significa `changed`, así que la forma documentada de aceptar un cambio intencionado no hacía nada, mientras el mensaje de fallo te decía que ejecutaras justamente esa opción.
- **Flutter en iOS y React Native en iOS compartían una misma referencia de captura**, así que una build de Flutter se comparaba con píxeles de React Native. iOS identifica ahora el motor de renderizado a partir del paquete de la app. Las referencias de iOS que venían en beta.4 se grabaron desde la build equivocada y se han vuelto a grabar.

Todo el detalle en el [changelog](https://github.com/Astur-mobile/Astur/blob/main/CHANGELOG.md).

## 0.5.0-beta.4

**Escribe en un campo que no puedes seleccionar.** Algunos campos no tienen nada a lo que apuntar: un campo OTP de varias casillas dibuja seis vistas planas y mantiene el campo real fuera del árbol de accesibilidad, así que `getByType('textField')` no encuentra nada y `fill()` no tiene elemento que rellenar. `device.keyboard.type()` envía el texto a lo que tenga el foco del teclado.

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

- La misma llamada en **iOS y Android**, así que un solo spec cubre ambos: XCUITest escribe en el responder con foco y Android entrega a la vista con foco.
- `pressKey()` escribe ahora un único carácter imprimible en **ambas** plataformas, así que un bucle dígito a dígito no necesita ramas por plataforma. Esto corrige además una arista fea en Android: un carácter suelto se interpretaba como un *número de keycode*, y el keycode 4 es `BACK`, de modo que `pressKey('4')` navegaba hacia atrás en vez de escribir un 4. Las teclas con nombre y los keycodes numéricos no cambian.
- Sin teclado en pantalla, iOS falla con `KEYBOARD_NOT_VISIBLE` en lugar de no hacer nada en silencio: el fallo señala la causa, no tres aserciones después.

**Un teclado fantasma navegaba por tu app a mitad de test.** En Android, el estado del teclado venía de dos señales que mienten: una marca `mImeShowing=true` que se queda pegada después de que el teclado desaparezca, y un rectángulo de límites que en realidad era el de la pantalla, con lo que reportaba un teclado a pantalla completa. Todos los elementos parecían tapados, así que Astur «cerraba» ese teclado pulsando Atrás y se salía de la pantalla. Ahora tanto el host como el agente en el dispositivo leen la fuente de insets del propio IME y tratan un marco de altura cero como oculto. Esto necesita el agente reconstruido que viene con `@astur-mobile/android`.

Usa `fill()` siempre que el campo sea direccionable: resuelve el elemento, lo vacía y confirma que el valor llegó. Nada de eso es posible cuando apuntas al foco. Consulta [Teclado y fill](../ios/#keyboard-and-fill).

## 0.5.0-beta.3

**Mira con qué habla tu app.** El nuevo `device.network` informa del tráfico HTTP que hace una app mientras un test la maneja, así que puedes afirmar sobre la llamada y no solo sobre los píxeles, y depurar un fallo sin reproducirlo a mano.

```ts
const capabilities = await device.network.capabilities();
test.skip(!capabilities.observe, capabilities.coverage);

await device.network.clear();
await app.login.signIn('qa@astur.dev', 'Astur12345');

const [request] = await device.network.requests({ url: '/api/session' });
expect(request).toMatchObject({ method: 'POST', status: 201 });
```

- Disponible hoy en **Flutter sobre Android**, mediante el perfilador HTTP de la Dart VM. Cubre el tráfico del `HttpClient` de `dart:io`, incluidos `package:http` y Dio.
- Pregunta con `capabilities()` en lugar de dar por hecho: informa de la cobertura por sesión, así que un spec se ejecuta en todas partes y se salta con un motivo donde la observación no está disponible.
- Cabeceras con credenciales ocultas y cuerpos con tope por defecto; el búfer se limpia entre tests.
- La interceptación (simular, retrasar o hacer fallar) **no** está en esta versión: necesita un adaptador dentro de la app. `capabilities().intercept` lo dice en vez de fallar de forma misteriosa.

Consulta [Observación de red](../network/) para el panorama completo.

**Correcciones que costaban ejecuciones enteras.**

- El agente de UiAutomator se había apropiado en silencio del teclado, los gestos y las acciones sobre elementos en sesiones de Flutter. Su `keyboard.dismiss` pulsa Atrás, lo que manda la app de Flutter a segundo plano y mata la Dart VM, y su `gesture.tap` no llega nunca a la vista de Flutter.
- Un fallo de acción sobre elemento en el agente recurre ahora a un toque por coordenadas en lugar de abortar el test. Arregla el selector de medios nativo en React Native sobre Android.
- Los desplazamientos para revelar eran impulsos, no arrastres: el mismo gesto a 300 ms se iba hasta el final del contenido; a 1200 ms se mueve de forma predecible. Los bucles de búsqueda ya no rebotan entre los extremos.
- Una lectura de la VM de Flutter podía bloquearse unos 7 minutos; los reintentos están ahora acotados por reloj, con la fecha límite propagada a cada petición.

## 0.5.0-beta.2

### Novedades

- **`by.native({ ios, android })`, una vía de escape en crudo para los elementos que ningún otro localizador puede fijar.** `ios` acepta una cadena de predicado de XCUITest; `android` acepta un selector estructurado (clase, texto, resource id, relaciones padre/hijo). Útil en pantallas con pocos o ningún dato de accesibilidad. Consulta las guías de [Android](../android/#native-selector-escape-hatch-bynative) e [iOS](../ios/#native-selector-escape-hatch-bynative).

### Corregido

- **`astur test` podía romperse con `spawn EINVAL` en Node 22 y 24** (en Node 20 funcionaba bien). Ahora ejecuta Playwright directamente en lugar de pasar por `npx`, eliminando la doble indirección de procesos que lo provocaba.
- **El inspector de Android ya no parpadea con «UI tree unavailable».** Si una ejecución anterior reventó o se mató, su agente en el dispositivo seguía ocupando la ranura de automatización de Android y rompía en silencio el árbol de la siguiente sesión. Astur limpia ahora la instrumentación del agente que quedó colgada y los reenvíos de puerto filtrados al arrancar una sesión, y cierra los suyos por completo al terminar: una salida en mal estado no puede envenenar la siguiente ejecución.
- Pequeña corrección de contraste en el Inspector, en el selector de lenguaje del código.

## 0.5.0-beta.1

### Novedades

- **Graba las nuevas aserciones desde el Inspector.** El compositor de aserciones ofrece ahora habilitado/deshabilitado/seleccionado/con foco y «número de coincidencias igual a» (genera `toHaveCount(n)`), junto a las comprobaciones ya existentes de texto, valor, etiqueta y tipo.

### Corregido

- **Fallo en Windows con `codegen` e `inspect`** ([#10](https://github.com/Astur-mobile/Astur/issues/10)). El inspector ya no muere con `Error: spawn start ENOENT` justo después de imprimir su URL: la apertura automática del navegador pasa ahora por `cmd /c start` en Windows, y un fallo al abrirlo no puede tumbar el inspector en ninguna plataforma (en el peor caso, abres tú la URL impresa).
- **Seguridad en codegen.** El Inspector se niega a grabar un paso de `fill` o `expect` para un objetivo sin localizador estable (mensaje claro en vez de código generado roto en silencio), y los valores de recuento se validan antes de añadir un paso.

## 0.5.0-beta.0

### Novedades

- **Lee el estado de los elementos directamente desde los localizadores.** `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()`, `isDisabled()`, `isSelected()`, `isFocused()`, además de `clear()` y un `waitFor({ state })` al estilo Playwright.
- **Aserción `toHaveCount`.** `await expect(device.getByRole('menuitem')).toHaveCount(3)`: sondea y reintenta como el resto de matchers de Astur.

### Mejorado

- **Consultas de múltiples coincidencias más rápidas en Android.** `queryAll()`, `count()` y `device.findMany()` se resuelven ahora de forma nativa en el dispositivo mediante el agente UIAutomator, en lugar de volcar el árbol de interfaz entero. Los agentes ya instalados más antiguos siguen funcionando por el camino anterior.

## 0.4.0-beta.0

### Mejorado

- **Escritura más rápida en campos de iOS.** Los valores cortos y seguros se mantienen en la vía tecleada fiable, los reemplazos largos y no seguros pueden usar pegado, y el estado del campo se verifica después de rellenarlo.
- **Mejor manejo del teclado en iOS.** Los toques están acotados, las comprobaciones de obstrucción del teclado se basan en marcos, y los flujos con varios campos evitan ciclos innecesarios de cerrar y reabrir.
- **Los rellenos en WebView se quedan en contexto web.** El Inspector y codegen reasignan ahora los campos nativos de WebView superpuestos a su nodo del DOM, para que el segundo relleno no acabe pasando por el agente nativo de iOS.
- **Arrastrar y soltar en codegen.** El Inspector tiene un modo Drag y graba las acciones de arrastre en el código generado.
- **Ciclo de vida más limpio del proxy de WebView en iOS.** Los procesos de `ios-webkit-debug-proxy` que quedaron colgados se limpian antes de que una nueva sesión ocupe el mismo puerto.

### Publicación

- Paquetes públicos subidos a `0.4.0-beta.0`.
- `package-lock.json` regenerado tras actualizar dependencias y versiones.

## 0.3.0-beta.0

### Novedades

- **DOM de WebView en el simulador de iOS.** `device.webContext()` maneja ahora el DOM de WebView (WKWebView) en el **simulador de iOS**, además de en dispositivos reales, con la misma API independiente del motor que se usa en Android. Necesita `ios-webkit-debug-proxy` (v1.9+) y que la app defina `WKWebView.isInspectable = true`; Astur conecta el simulador automáticamente.
- **Flutter en iOS.** La suite de demostración compartida se ejecuta en el simulador de iOS contra la build de Flutter, leída a través del árbol de accesibilidad de XCUITest.

### Mejorado

- **Rellenos más rápidos y fiables en iOS.** Evita reescribir cuando el campo ya tiene el valor, teclea en campos seguros y cortos (y pega los textos largos), y mantiene el teclado abierto entre campos de un formulario, cerrándolo solo cuando bloquea el siguiente toque.
- **Codegen e Inspector más fluidos.** Las acciones de dispositivo pausan ahora el sondeo en segundo plano de capturas, árbol y WebView, lo que elimina el parpadeo de «reintentando» a mitad de un relleno y una pérdida de contexto de WebView que podía ocurrir entre dos rellenos.
- **Se acabaron los toques atascados.** Un toque sobre un control tapado por el teclado ya no se queda colgado.

### Ejemplos y boilerplate

- Ejemplos reorganizados: los tests compartidos viven en `specs/` y las configuraciones por plataforma en `config/android/` y `config/ios/`. `create-astur` genera en `specs/` para que coincida.

### Notas y límites

- El DOM de WebView en iOS necesita `brew install ios-webkit-debug-proxy`. El fixture `web.page` (`webview()`) de Playwright sigue siendo solo para Android; en iOS usa `device.webContext()`.
- Flutter: Android necesita un APK **debug**, la CLI de `flutter` y `ASTUR_FLUTTER_PROJECT`; iOS expone los widgets mediante accesibilidad (añade `Semantics(identifier:)`). Consulta [Requisitos previos](../prerequisites/) y [Límites de plataforma](../platform-limits/).

> Línea beta: las API todavía pueden cambiar entre versiones beta.
