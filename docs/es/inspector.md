# Inspector y codegen de Astur

El Inspector de Astur es la superficie visual para escribir tests móviles. Transmite la pantalla del dispositivo, lee el árbol semántico de la interfaz con el mismo runtime que usan los tests, ordena localizadores, graba acciones y exporta código de `@astur-mobile/test`.

A diferencia de los inspectores genéricos de WebDriver o Appium, el Inspector de Astur está construido sobre el propio runtime de Astur. Eso le da tres ventajas prácticas:

- los localizadores generados usan el mismo motor de selectores que se ejecutará en tus tests
- los toques, scrolls, escrituras, arranque de la app, permisos, rotación y capturas pasan por la misma sesión nativa de Android o iOS que usa `@astur-mobile/test`
- el Inspector puede ordenar localizadores semánticos localmente desde el árbol en caché, en lugar de esperar una ida y vuelta completa tras cada selección

El resultado es un ciclo de escritura más ágil: inspeccionar, interactuar, grabar, editar el paso generado, cambiar de dispositivo, lanzar otra app instalada y seguir sin cambiar de herramienta.

## El Inspector en acción

<div class="astur-video-card">
  <div class="astur-video-copy">
    <span class="astur-video-kicker">RECORRIDO POR EL INSPECTOR</span>
    <strong>Inspecciona, interactúa, graba y exporta.</strong>
    <p>Mira cómo el Inspector de Astur convierte una sesión en vivo con un dispositivo en pasos de test mantenibles al estilo Playwright.</p>
    <a class="astur-video-link" href="https://www.youtube.com/watch?v=QgHdjJqinXs" target="_blank" rel="noreferrer">Ver en YouTube <span aria-hidden="true">↗</span></a>
  </div>
  <div class="astur-video-frame">
    <iframe src="https://www.youtube-nocookie.com/embed/QgHdjJqinXs" title="Recorrido por el Inspector de Astur" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
  </div>
</div>

![El Inspector de Astur: el espejo del dispositivo en el centro, el árbol de interfaz en vivo a la derecha y los localizadores ordenados con los detalles del elemento a la izquierda.](./images/inspector-ios-simulator.png)

Arráncalo con:

```bash
npx astur-mobile codegen
```

Ejemplos por plataforma:

```bash
npx astur-mobile codegen --android --device emulator-5554 --app ./MyApp.apk --app-id com.example.myapp
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
npx astur-mobile codegen --ios --real --device <udid-del-dispositivo> --app ./MyApp.ipa --app-id com.example.myapp
```

Un `npx astur-mobile codegen --ios` a secas usa `com.astur.demo` como bundle id por defecto. Para tu propia app de iOS, pasa `--app` y `--app-id` (o define `ASTUR_IOS_BUNDLE_ID`), o lanza la app desde los controles del Inspector. Para probar Astur sin una compilación propia, usa la app de demostración del repositorio de ejemplos: `--app ./Astur.app --app-id com.astur.demo`.

## Controles de la cabecera

La cabecera tiene dos controles: la etiqueta del dispositivo actual y el botón `Controls`.

### Cambiar de dispositivo

La etiqueta del dispositivo muestra el dispositivo activo. Haz clic para abrir la lista y cambiar a otro sin reiniciar el Inspector, incluso entre tipos y plataformas: un emulador de Android, un dispositivo Android real, un simulador de iOS o un dispositivo iOS real.

![El selector de dispositivos: la etiqueta del dispositivo activo y una lista de dispositivos Android e iOS disponibles, cada uno con su tipo.](./images/inspector-device-switcher.png)

Al cambiar, Astur cierra por completo la sesión actual **antes** de conectarse a la siguiente, de modo que nunca hay dos sesiones nativas a la vez (algo que si no duplicaría la memoria: dos runners de XCUITest, cada uno reteniendo un simulador, o dos agentes de Android). El espejo muestra brevemente `Preparing device…` mientras se conecta el nuevo dispositivo.

Los argumentos con los que arrancaste se trasladan al nuevo dispositivo cuando siguen teniendo sentido:

- el **identificador de app** (bundle id o paquete) se traslada dentro de la misma plataforma, incluido simulador de iOS ↔ dispositivo real
- el **artefacto de `--app`** solo se traslada cuando encaja con el destino: `.apk` para Android, un `.app` de simulador para un simulador de iOS, un `.ipa` firmado para un dispositivo iOS real

#### Limitaciones al cambiar

- **Simulador de iOS ↔ dispositivo real** conserva el bundle id pero no el archivo de la app: un `.app` de simulador no se puede instalar en un dispositivo real (necesita un `.ipa` firmado), y viceversa. Si la app ya está instalada en el destino, el cambio se conecta a ella; si no, el cambio no puede completarse.
- **Los cambios entre plataformas** (Android ↔ iOS) descartan el artefacto de la app por completo e inspeccionan el estado actual del dispositivo, porque `.apk` y `.app`/`.ipa` no son intercambiables.
- **Un cambio fallido no destruye nada.** Si Astur no puede conectarse al dispositivo elegido, vuelve a conectarse al anterior e informa `Switch to <device> failed: … — stayed on <previous>`, así que la sesión sigue siendo utilizable en vez de dejarte con un agente cerrado.
- **Los dispositivos iOS reales** siguen necesitando firma de Apple, Modo Desarrollador y la app instalada y firmada para el dispositivo. El Inspector no puede crear una build firmada a partir de un `.app` de simulador; arranca una sesión de dispositivo real con `--ios --real --app <firmada.ipa>` para tener control completo.

### Controles

El botón `Controls` reúne acciones de dispositivo, de app y de sesión:

- instalar un APK, un `.app` de simulador o un `.ipa` de dispositivo real
- lanzar una app instalada por nombre de paquete o bundle id
- conceder o revocar permisos
- borrar datos o caché de la app donde sea posible
- rotar, refrescar, bloquear y desbloquear, ocultar el teclado y acciones de navegación de Android
- **terminar la sesión** (fila Session, más abajo)

![El panel Controls: arranque e instalación de la app, permisos, datos y caché, la fila de acciones del dispositivo y la sección Session con Terminate.](./images/inspector-controls.png)

Lanzar una app de iOS desde `Controls` reenlaza además el agente XCUITest al bundle id introducido, con lo que el árbol de interfaz y las interacciones nativas empiezan a funcionar para esa app.

### Terminar una sesión

El botón **Terminate session** (Controls → Session) cierra el Inspector limpiamente y libera todos los recursos. Tras confirmar, Astur:

- cierra la sesión del dispositivo, deteniendo el agente nativo o el runner de XCUITest para liberar memoria del host, y
- **apaga el emulador o el simulador** para que el dispositivo virtual deje de consumir memoria.

Los dispositivos reales se dejan encendidos: Astur no apaga hardware que es tuyo. El Inspector muestra entonces una capa con `Session terminated` y el proceso de `codegen` termina.

## Grabación

Pulsa `Record` y luego interactúa con la pantalla reflejada.

- los clics ejecutan primero un toque nativo por coordenadas y después registran el mejor localizador semántico disponible
- si no existe un localizador estable, Astur registra `device.tap({ x, y })`
- el scroll con la rueda del ratón o el arrastre sobre el espejo ejecutan un swipe nativo
- el scroll está disponible mientras inspeccionas, y solo se graba cuando `Record` está activo
- `+ Fill` y `+ Expect` usan editores en línea, no diálogos del navegador
- las aserciones admiten comprobaciones de visibilidad, texto exacto, texto contenido, valor, etiqueta y tipo

Cada interacción aparece en la pestaña **Recording Steps** como una fila editable de acción y localizador:

![La pestaña Recording Steps con los toques grabados y sus localizadores generados.](./images/inspector-recording-steps.png)

La pestaña **Code** convierte esos pasos en un spec de `@astur-mobile/test` listo para ejecutar (elige TypeScript o JavaScript y copia):

![La pestaña Code mostrando el spec de @astur-mobile/test generado a partir de los pasos grabados.](./images/inspector-generated-code.png)

El código exportado es deliberadamente sencillo:

```ts
import { test, expect } from '@astur-mobile/test';

test('recorded flow', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Login' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

## Requisitos del árbol en iOS

Las capturas del simulador de iOS pueden aparecer antes de que el árbol esté listo. En dispositivos iOS reales, el primer fotograma reflejado también depende del agente XCUITest en Swift, porque Apple no expone la misma vía de captura programable a través de `devicectl`.

La inspección del árbol de interfaz y la interacción nativa requieren el agente XCUITest en Swift. Si el panel derecho dice que el árbol no está disponible:

<ol class="astur-steps">
  <li>Confirma que la app está instalada en el simulador o dispositivo seleccionado.</li>
  <li>Lánzala o reenlázala desde <code>Controls</code> con el bundle id de la app.</li>
  <li>O reinicia codegen con <code>--ios --app-id &lt;bundle-id&gt;</code>.</li>
  <li>Para dispositivos reales, define <code>ASTUR_IOS_DEVELOPMENT_TEAM</code> para poder firmar el runner de XCUITest.</li>
  <li>Si la terminal pide <code>Password:</code> una y otra vez, desbloquea el llavero de inicio de sesión de macOS o permite el acceso de codesign al certificado de Apple Development.</li>
  <li>Ejecuta <code>npx astur-mobile doctor --verbose</code> si falla Xcode o la compilación del agente.</li>
</ol>

:::note[Apple XCTest]
Es un requisito de XCTest de Apple. No es una dependencia de Appium ni de WebDriver.
:::

:::tip[Refresco retrasado]
Si el árbol se ve pero la cabecera indica brevemente `UI tree refresh delayed`, Astur está manteniendo el último árbol correcto mientras la siguiente instantánea de XCUITest sigue en marcha. El espejo se puede seguir usando; el aviso debería desaparecer tras el siguiente refresco correcto.
:::

## DOM de WebViews

Cuando el dispositivo tiene una WebView interna inspeccionable, el Inspector **inserta su DOM en el árbol de interfaz**, bajo el nodo nativo que la aloja. Cada elemento web muestra el mismo localizador estable que Astur generaría para los tests (`getByTestId`, `getById`, `getByRole`, `getByText`), y los controles **Fill** y **Tap** manejan elementos web por su localizador del DOM, sin adivinar coordenadas.

Esto reutiliza `device.webContext()`, así que funciona con WebViews de **Flutter y React Native** en Android (WebView de Chromium/CDP) y en iOS — **tanto en simulador como en dispositivos reales** — mediante `ios-webkit-debug-proxy`. El DOM se sondea en segundo plano y nunca bloquea el árbol nativo. Consulta [WebViews (DOM)](../frameworks/#webviews-dom) para la preparación y la tabla de compatibilidad.

## Límites de plataforma

La ejecución en dispositivos iOS reales está soportada para dispositivos de confianza conectados por USB y con Modo Desarrollador activado. Sigue necesitando firma de Apple: define `ASTUR_IOS_DEVELOPMENT_TEAM`, usa una app firmada para el dispositivo y define `ASTUR_IOS_AGENT_HOST` solo si el teléfono no alcanza la IP del Mac que Astur detecta automáticamente.

En dispositivos iOS reales, los tests usan comandos nativos concretos y son el camino fiable. El dibujado del árbol en el Inspector todavía depende de instantáneas amplias de accesibilidad de XCTest, así que la pantalla reflejada se vuelve utilizable en cuanto el agente puede devolver fotogramas, mientras que el árbol puede llegar más tarde o refrescarse despacio en pantallas grandes. Prefiere el simulador de iOS para escribir y generar código cuando necesites un árbol en vivo rápido; usa dispositivos reales para la validación final hasta que el Inspector incorpore un flujo compacto del árbol nativo.

La gestión de alertas del sistema está limitada por lo que expone XCTest. Astur puede consultar e interactuar con las alertas que XCTest ve, pero iOS no expone todos los diálogos del sistema o paneles de permisos mediante consultas normales de la app de forma estable entre versiones.

El borrado de datos y caché de apps en el simulador de iOS es deliberadamente «reiniciar reinstalando». `simctl` admite instalar, desinstalar, lanzar, cerrar y controlar privacidad, pero no expone la misma API directa de borrado de datos o caché por app que Android ofrece mediante comandos del gestor de paquetes.

El código de `agents/ios-xctest-agent/` es el agente XCUITest en Swift incluido. Es la parte nativa de iOS de Astur: se enlaza al bundle id de la app, lee el árbol de accesibilidad, ejecuta toques, escrituras y deslizamientos nativos, captura pantallas en dispositivos reales y devuelve resultados JSON compactos al runtime de Node.js. No elimina las restricciones de firma, aprovisionamiento e interfaz del sistema que Apple impone en dispositivos reales.

## Notas de rendimiento

La selección en el Inspector usa el árbol semántico en caché para ordenar localizadores, así que hacer clic en elementos no debería provocar una lectura completa del árbol en cada selección. Las acciones grabadas se ejecutan primero mediante gestos nativos por coordenadas, para evitar reintentos lentos de localizador mientras estás interactuando con el espejo.

Los gestos de scroll están limitados por tasa tanto en el navegador como en el servidor. Un scroll rápido de trackpad se agrupa en swipes nativos acotados, para que el dispositivo no reciba una cola ilimitada de gestos.

El servidor del Inspector escucha solo en `127.0.0.1`. Concede control total del dispositivo sobre una conexión local sin autenticar, así que deliberadamente no es alcanzable desde otras máquinas de la red. Abre la URL `http://localhost:<puerto>` que se imprime en el mismo Mac que arrancó la sesión.
