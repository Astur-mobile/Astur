---
title: "Límites de plataforma"
description: "Límites reales de Android e iOS que Astur declara en vez de disimular."
sidebar:
  order: 10
---
Astur quita Appium de la ecuación, pero no puede quitar las reglas de cada plataforma.

## Sistemas operativos anfitriones

| SO anfitrión | Android | iOS |
| --- | --- | --- |
| macOS | Compatible | Compatible con simuladores y dispositivos reales por USB, mediante las herramientas de Xcode y el agente XCUITest |
| Linux | Compatible | Se omite en local |
| Windows | Compatible | Se omite en local |

## Android

Android expone suficientes herramientas públicas para una automatización nativa útil sin necesidad de un SDK dentro de la app:

- ADB puede instalar, lanzar, detener, hacer capturas e inyectar entrada.
- UIAutomator puede exponer un árbol de interfaz respaldado por accesibilidad.
- El Chrome DevTools Protocol puede automatizar Chrome y las WebViews depurables.

Astur incluye ya una base de agente UIAutomator en Kotlin bajo `agents/android-uiautomator`, que es el camino nativo por defecto para la interacción en Android.

Estado actual:

- el driver de Android en el host admite el arranque del agente nativo y la configuración del transporte por endpoint
- sigue disponible el camino alternativo de ADB con XML de UIAutomator
- el agente Kotlin admite `tree.get` básico, espera/búsqueda/acciones sobre elementos, comandos de gestos y estado y ocultación del teclado
- los diagnósticos más ricos y una paridad más profunda de selectores siguen en curso

## Web móvil (destinos de navegador)

`device.browser` maneja una página en el navegador del dispositivo — Chrome en Android, Safari en iOS. Consulta [Web móvil](../mobile-web/) para la guía completa; aquí se resumen los límites.

- **El almacenamiento no está aislado en ninguna de las dos plataformas.** Una pestaña no es un browser context de Playwright: las cookies, `localStorage` y los permisos pertenecen al perfil del navegador y se comparten entre pestañas. Límpialos explícitamente cuando un test dependa de ello.
- **Android obtiene una pestaña por test**, creada y cerrada a través del socket de depuración. **iOS no** — el inspector remoto de WebKit no expone el ciclo de vida de las pestañas, así que la sesión reutiliza una y la recarga.
- **La interfaz del propio navegador no forma parte de la página.** La barra de direcciones, el selector de pestañas y los diálogos de permisos son vistas nativas; necesitan localizadores nativos y un agente, y no se incluyen page objects para ellos.
- **Chrome tiene que haber pasado su pantalla de primer arranque** antes de abrir una pestaña o publicar un socket de depuración. Astur informa `BROWSER_FIRST_RUN_PENDING` en lugar de agotar el tiempo de espera. Basta con completarla una vez por imagen de emulador.
- **iOS necesita `ios-webkit-debug-proxy` (v1.9+)**, y un dispositivo real necesita además Ajustes ▸ Safari ▸ Avanzado ▸ Inspector web.
- **Los dispositivos iOS reales no están verificados.** El camino de código existe, pero no se ha ejecutado contra hardware físico.

## Flutter

Astur automatiza apps de Flutter sin Appium y sin un driver de terceros específico de Flutter. Consulta [Flutter y React Native](../frameworks/) para la guía de preparación completa; aquí se resumen los límites.

En **Android**, Astur se conecta al **servicio Dart VM** y lee el **árbol de widgets** de Flutter en vivo (identificador de Semantics, texto, etiqueta, valor, límites), no solo la capa de accesibilidad.

Lo que funciona hoy (Android, servicio Dart VM):

- detectar automáticamente un APK de Flutter, lanzarlo y hacer hot restart entre tests
- inspeccionar el árbol de widgets anidado en el inspector en vivo y en codegen
- `getById` (identificador de Semantics), `getByText`, `getByLabel`
- tap, doble tap, pulsación larga, `fill` (con `toHaveValue`) y swipe
- orientación, capturas y artefactos de vídeo nativos

Requisitos y límites:

- requiere un APK **debug o profile** (el servicio VM no existe en compilaciones release)
- requiere **`ASTUR_FLUTTER_PROJECT`** (el directorio fuente de la app Flutter) y la CLI de `flutter` en el `PATH` (o `ASTUR_FLUTTER_PATH`)
- solo aparecen en el árbol los widgets **en pantalla**: desplaza primero el objetivo hasta que sea visible
- la **interfaz nativa fuera de Flutter** (diálogos de permisos del sistema, el selector nativo de fotos o archivos, las hojas de compartir) no es visible para el servicio Dart VM
- el arrastre fino sobre widgets de pan personalizados mediante entrada sintética puede ser impreciso

En **iOS** no hay servicio Dart VM: las apps de Flutter se leen a través del árbol de accesibilidad de XCUITest. La suite de demostración compartida ejecuta **6 de 9 specs** en el simulador de iOS (login, formularios, deslizador, orientación y menú, swipe y tap-laboratory). Añade `Semantics(identifier:)` estables a los widgets que necesiten los tests; el agente de iOS de Astur añade una coincidencia parcial sobre las etiquetas de accesibilidad fusionadas de Flutter para que `getByText` siga resolviendo. Quedan excluidos en Flutter sobre iOS: **arrastrar y soltar** (solo el primer arrastre sintético de XCUITest de una secuencia llega al reconocedor de pan de Flutter), además de **subida de archivos** y **webview** (las mismas exclusiones que en React Native sobre iOS). Consulta [Flutter en iOS](../frameworks/#flutter-on-ios-xcuitest-accessibility-tree).

## iOS

iOS no expone un equivalente público a ADB para controlar la interfaz nativa de forma arbitraria.

Para apps nativas, el camino fiable es XCTest/XCUITest. Astur lo mantiene directo y mínimo:

- sin servidor Appium
- sin capa de traducción WebDriver
- un agente XCUITest en Swift mantenido por el propio proyecto

Estado actual:

- el driver de iOS admite el arranque del agente incluido y la configuración del transporte por endpoint
- el ciclo de vida del simulador y los flujos de captura funcionan mediante `simctl`
- la instalación, arranque, cierre, desinstalación, búsqueda de procesos y descubrimiento en dispositivos reales funcionan mediante `devicectl`
- la búsqueda de elementos nativos, esperas, tap, doble tap, pulsación larga, `fill`, arrastre, swipe, orientación, capturas y comandos de teclado funcionan mediante el agente XCUITest en Swift, tanto en simulador como en dispositivo real

Usar iOS en dispositivos reales exige firma de Apple, dispositivos de confianza, Xcode y aprovisionamiento. Astur gestiona el ciclo de vida de la automatización, pero no puede inventarse una identidad de firma para el runner de XCTest incluido.

Límites técnicos:

- Ejecutar en un dispositivo iOS real requiere un equipo de desarrollo de Apple configurado y una app firmada para ese dispositivo. Usa `ASTUR_IOS_DEVELOPMENT_TEAM` para instalaciones desde npm y para CI, o selecciona un equipo en el proyecto Xcode fuente si desarrollas sobre el repositorio en local.
- Las alertas del sistema están limitadas por lo que XCTest alcanza a ver. Si XCTest no puede consultar de forma fiable un diálogo del sistema, Astur no puede prometer una superficie de automatización estable entre versiones.
- Las herramientas públicas de iOS no exponen el borrado directo de datos o caché por app; el camino fiable para reiniciar el estado es desinstalar y reinstalar desde una ruta de app.
- El bloqueo y desbloqueo, la modificación de permisos y la grabación de vídeo en dispositivos reales no están expuestos de forma fiable por las herramientas locales públicas de Apple. Los tests en dispositivo real sí pueden adjuntar capturas mediante el agente XCUITest.
- La automatización del DOM en WebView (WKWebView) funciona **tanto en el simulador de iOS como en dispositivos reales** mediante `device.webContext()`, usando `ios-webkit-debug-proxy` (v1.9+) como puente al Web Inspector remoto de WebKit. Requiere `WKWebView.isInspectable = true` (iOS 16.4+) y `brew install ios-webkit-debug-proxy`. En el **simulador**, Astur localiza el socket `webinspectord_sim` correspondiente y lo maneja automáticamente mediante el modo `-s` de iwdp, sin configuración adicional. En un **dispositivo real**, activa además Ajustes ▸ Safari ▸ Avanzado ▸ Inspector web. WebKit moderno multiplexa el tráfico de páginas por el dominio `Target`; el evaluador de Astur lo envuelve y desenvuelve de forma transparente, así que el mismo puente de JavaScript inyectado maneja WKWebView y la WebView de Chromium por igual. Las pantallas con WebView también funcionan como interfaz nativa mediante XCUITest en cualquier caso. (El DOM de las WebViews internas en Android funciona mediante el Chrome DevTools Protocol cuando la app activa la depuración de WebView — consulta [WebViews (DOM)](../frameworks/#webviews-dom)).

El código de `agents/ios-xctest-agent/` es el agente XCUITest en Swift que se incluye. Se enlaza al bundle id de destino, lee el árbol de accesibilidad, ejecuta gestos y acciones nativas sobre elementos y devuelve JSON compacto al runtime de Node.js. Resuelve el árbol de interfaz y la ejecución de acciones en iOS; no esquiva la firma, el aprovisionamiento ni las restricciones de la interfaz del sistema de Apple.
