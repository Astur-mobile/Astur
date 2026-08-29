# Web móvil

Controla una **página web en el navegador del dispositivo** — Chrome en Android, Safari en iOS — en el mismo emulador, simulador o dispositivo real donde corre tu suite nativa.

```ts
const page = await device.browser.open('https://example.com/pricing');

await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
await page.getByTestId('plan-pro').tap();
```

## Cuándo es esta la herramienta adecuada

Astur tiene dos superficies web, y responden a preguntas distintas:

| Lo que estás probando | Usa |
| --- | --- |
| Una pantalla con WebView **dentro** de tu app | [`device.webContext()`](../frameworks/#webviews-dom) |
| Un **sitio web** en el navegador del dispositivo | `device.browser` |

Por debajo son la misma maquinaria: en cuanto una pestaña es inspeccionable, la maneja el mismo puente de JavaScript inyectado. Lo que añade un navegador es el destino y la navegación.

**Playwright ya prueba muy bien la web móvil** mediante emulación de dispositivos, y es más rápido y más cómodo de ejecutar en CI. Recurre a `device.browser` cuando la emulación no sea lo que necesitas: un navegador real de Android o iOS, en el mismo conjunto de dispositivos, en la misma ejecución y en el mismo informe que tu suite nativa.

## Preparación

Define `browser` en lugar de `app`:

```ts
export default defineConfig({
  use: {
    astur: {
      platform: 'android',
      device: { kind: 'emulator', avd: 'Pixel_9_API_35' },
      browser: { engine: 'chrome' }   // 'safari' en iOS
    }
  }
});
```

Una configuración con `browser` y sin `app` es una **sesión solo de navegador**: Astur se salta la instalación de la app y trata el agente nativo como opcional en lugar de obligatorio. En iOS eso es la diferencia entre abrir una página web y necesitar antes una identidad de firma de Xcode.

Define `app` y `browser` a la vez cuando una misma suite haga las dos cosas por turnos; la preparación nativa se queda exactamente como estaba.

`engine` e `id` son opcionales: `engine` toma por defecto el navegador de serie de la plataforma, e `id` sobrescribe el paquete o el bundle id para un canal de Chrome como `com.chrome.beta`.

## La API

```ts
// ¿Qué puede hacer esta sesión con un navegador?
const capabilities = await device.browser.capabilities();
// { supported, engine, identifier, coverage }

const page = await device.browser.open('https://example.com');   // WebContext
const next = await device.browser.navigate('https://example.com/pricing');
const again = await device.browser.reload();
const back = await device.browser.back();
await device.browser.forward();

await device.browser.url();     // URL actual
await device.browser.close();   // cierra el transporte, deja el navegador abierto
```

Cada navegación devuelve la página viva: usa a partir de ahí el objeto devuelto.

## Ciclo de vida de las pestañas

Parecido al de Playwright, dentro de lo que permite cada plataforma:

- **`open()` da al test una pestaña nueva.** En Android, Astur la crea a través del socket de depuración, igual que Playwright abre una página nueva.
- **La pestaña se cierra al terminar el test.** El fixture de Astur lo hace por ti, así que las pestañas no se acumulan y ningún test hereda el DOM, el historial ni la posición de scroll del anterior.
- **`open()` siempre carga**, aunque la pestaña ya muestre esa URL, para que una pestaña reutilizada no le pase a un test el formulario que rellenó el anterior.

**iOS es más limitado aquí, y es un límite de la plataforma, no una decisión.** El inspector remoto de WebKit no ofrece forma de crear ni cerrar una pestaña de Safari, así que una sesión de iOS reutiliza una y la recarga. El estado que vive en el documento sí se reinicia con la recarga; el historial de la pestaña no.

El almacenamiento es otra cuestión, y **no** está aislado — consulta [Límites](#límites).

Todo lo que devuelve la página es un `WebContext`, el mismo objeto que da `device.webContext()`: `getByTestId`, `getById`, `getByRole`, `getByText`, `locator(css)`, `fill`, `tap`, `textContent`, `evaluate`.

## Pregunta antes de afirmar

`capabilities()` responde en todas las plataformas, así que el spec sigue siendo portable:

```ts
const capabilities = await device.browser.capabilities();
test.skip(!capabilities.supported, capabilities.coverage);
```

## Límites

Conviene leerlos antes de montar una suite sobre esto. Ninguno es un fallo: es lo que exponen las plataformas.

| Límite | Por qué | Afecta a |
| --- | --- | --- |
| **El almacenamiento no está aislado** | Una pestaña no es un *browser context* de Playwright. Las cookies, `localStorage` y los permisos pertenecen al perfil del navegador y se comparten entre pestañas. | Ambas |
| **Sin aislamiento de pestañas en iOS** | El inspector remoto de WebKit no ofrece forma de crear ni cerrar una pestaña de Safari, así que la sesión reutiliza una y la recarga. | iOS |
| **La interfaz del navegador no es la página** | La barra de direcciones, el selector de pestañas y los diálogos de permisos son vistas nativas. Necesitan localizadores nativos y un agente, y todavía no hay page objects para ellos. | Ambas |
| **No hay cambio de pestaña ni varias ventanas** | Solo se maneja la pestaña bajo prueba. | Ambas |
| **Chrome debe haber pasado su pantalla de primer arranque** | Hasta completar el asistente de bienvenida, Chrome no abre pestaña ni publica socket de depuración. Se informa como `BROWSER_FIRST_RUN_PENDING` en vez de agotar el tiempo. | Android |
| **Los dispositivos iOS reales no están verificados** | El camino de código existe (`devicectl` y Safari), pero no se ha ejecutado contra hardware físico. | Dispositivo iOS real |

Si un test depende de empezar con la sesión cerrada, limpia ese estado explícitamente en vez de dar por hecho que una pestaña nueva lo hizo:

```ts
await page.evaluate('localStorage.clear(); sessionStorage.clear()');
```

## Requisitos

**Android** necesita Chrome instalado, la depuración USB activada (que es lo que hace alcanzable `chrome_devtools_remote`) y Chrome más allá de su **pantalla de primer arranque**. Hasta completar ese asistente, Chrome no abre pestaña ni publica socket de depuración; Astur lo detecta y falla con `BROWSER_FIRST_RUN_PENDING` en lugar de esperar por una página que nunca va a aparecer. Basta con completarlo una vez por imagen de emulador.

**iOS** necesita `ios-webkit-debug-proxy` (v1.9+):

```bash
brew install ios-webkit-debug-proxy
```

En un **dispositivo real**, activa además Ajustes ▸ Safari ▸ Avanzado ▸ Inspector web. El simulador no necesita nada más: Astur conecta automáticamente su socket de inspector.

`npx astur-mobile doctor` informa de ambos casos.

## Pruébalo

La suite de ejemplo sirve su propia página desde el repositorio, así que se ejecuta sin conexión y de forma determinista:

```bash
cd examples
npm run test:android:browser
npm run test:ios:browser
```

Consulta [Flutter y React Native](../frameworks/) para las WebViews internas, y [Límites de plataforma](../platform-limits/) para la referencia completa.
