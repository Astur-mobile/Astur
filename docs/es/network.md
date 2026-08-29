# Observación de red

Mira el tráfico HTTP que hace tu app mientras un test la maneja: qué pidió, qué le respondieron y cuánto tardó.

## Por qué querrás esto

Cuando una pantalla se comporta mal, la pregunta interesante casi siempre es *«¿qué le pidió realmente al servidor?»*. Sin una respuesta acabas leyendo los logs de la app junto a la ejecución del test y adivinando la correlación.

En concreto, te permite:

- **Afirmar sobre la llamada, no solo sobre los píxeles.** «Pulsar Guardar hace un POST a `/api/session` y devuelve 201» es una afirmación mucho más fuerte que «apareció un aviso de éxito».
- **Detectar las llamadas que no esperabas**: una petición duplicada, una tormenta de reintentos, un ping de analítica que se dispara con cada tecla.
- **Depurar un fallo sin depurador.** Una ejecución fallida te dice que la petición devolvió 404, en vez de dejarte reproducirla a mano.
- **Mantener los secretos fuera de los informes.** Las cabeceras con credenciales se ocultan antes de que se devuelva ningún registro.

## Qué cubre y qué no

Astur informa del **tráfico instrumentado de la aplicación**, nunca de «todo el tráfico del dispositivo». Esa distinción es el diseño entero, así que conviene decirlo claro: las peticiones propias de una WebView, las llamadas de un SDK nativo y el tráfico por canales de plataforma son invisibles, y siempre lo serán, para este backend.

| Destino | Observar | Interceptar |
| --- | --- | --- |
| Flutter en Android | **Sí** — perfilador HTTP de Dart VM | necesita el adaptador en la app |
| Flutter en iOS (simulador) | **Sí** — perfilador HTTP de Dart VM | necesita el adaptador en la app |
| Flutter en iOS (dispositivo real) | No — el servicio VM no es alcanzable desde el host | necesita el adaptador en la app |
| React Native en Android | **Sí** — dominio `Network` de CDP (build debug sobre Metro) | necesita el adaptador en la app |
| React Native en iOS | **Sí** — dominio `Network` de CDP (build debug sobre Metro) | necesita el adaptador en la app |
| Nativo Android / iOS | No — no existe un punto de enganche equivalente | necesita el adaptador en la app |

En Flutter la fuente es el perfilador HTTP de `dart:io` de la Dart VM, el mismo que lee la vista Network de Flutter DevTools. Cubre el `HttpClient` de `dart:io` y, por tanto, `package:http` y Dio, ya que ambos se apoyan en él.

En React Native la fuente es el dominio `Network` de CDP que lee React Native DevTools. Como el reportero vive en `ReactCommon` — la capa C++ compartida —, una sola implementación cubre Android e iOS por igual.

El soporte se detecta **en tiempo de ejecución**, consultando las extensiones registradas del isolate. Nunca se deduce de «esto es una app de Flutter», lo cual importa, porque la misma app puede admitirlo o no según cómo se haya compilado.

### Flutter necesita una build debug o profile

La observación lee el servicio Dart VM, y una **build release (AOT) no tiene ninguno**: no hay nada a lo que conectarse, en ninguna de las dos plataformas. Las builds debug y profile sí lo publican. Esto no es una limitación de Astur y no se puede rodear desde fuera:

- **Android** se lanza mediante la herramienta de Flutter, así que el requisito de debug ya forma parte de ejecutar la suite.
- El **simulador de iOS** no necesita nada más. Una `.app` en debug arranca su servicio VM por sí sola y registra la URL, y en el simulador esa URL ya está en el loopback del host, así que Astur se conecta sin cambiar cómo se instala, se lanza ni se maneja la app.
- Los **dispositivos iOS reales** mantienen el servicio VM en el propio dispositivo, detrás de un túnel usbmuxd que Astur todavía no abre. Se informa como no soportado en lugar de intentarlo.

### React Native necesita una build debug sobre Metro

El reportero de React Native está detrás de la marca de compilación `REACT_NATIVE_DEBUGGER_ENABLED`. En una build release el código sencillamente no está e `isDebuggingEnabled()` devuelve `false`, así que, igual que con las builds release AOT de Flutter, no hay nada a lo que conectarse ni forma de cambiarlo desde fuera de la app.

Lo que eso exige en la práctica:

1. **Ejecuta una build debug.** `npx expo run:android`, `npx react-native run-android` o el comando equivalente de iOS.
2. **Mantén Metro en marcha.** La app se conecta al servidor de desarrollo; Astur se conecta a ese mismo servidor como un cliente CDP corriente. **No** sustituye a Metro, y no necesita proxy, ni certificado, ni cambiar cómo se lanza o se maneja la app.
3. **Indica a Astur dónde está el servidor de desarrollo** si no es el `http://127.0.0.1:8081` por defecto: define `ASTUR_RN_DEV_SERVER`.
4. **No dejes que la ejecución reinstale una build release** encima de la de debug: eso se llevaría por delante el destino del inspector. Una configuración para build debug da a `app` un `packageName` o `bundleId` y ningún `path`, como hacen `examples/config/{android,ios}/playwright.rn-debug.config.ts`.

En **iOS** no hace falta nada más: el `AppDelegate` de serie ya carga desde Metro bajo `#if DEBUG`. Los dos ajustes de Android de más abajo solo existen porque un proyecto puede desactivarlos para que las builds debug funcionen de forma autónoma.

Astur identifica el destino del inspector por el identificador de aplicación — el nombre de paquete en Android, el bundle id en iOS —, así que un servidor de desarrollo que se quedó abierto para otro proyecto nunca puede confundirse con la app bajo prueba.

Si una app de **Android** se configuró para funcionar de forma autónoma en debug, hay que devolver dos ajustes a sus valores por defecto de React Native, y **ambos son solo de debug, así que las builds release no se ven afectadas en absoluto**:

```kotlin
// android/app/src/main/java/…/MainApplication.kt
ExpoReactHostFactory.getDefaultReactHost(
  context = applicationContext,
  useDevSupport = BuildConfig.DEBUG,  // no un false fijo
  …
)
```

```groovy
// android/app/build.gradle
react {
    debuggableVariants = ["debug"]   // no []
}
```

#### Qué cubre la observación en React Native

Todo lo que pasa por el **`XMLHttpRequest`** de React Native, que es su propio polyfill de `fetch`, `axios` y la mayoría de librerías HTTP del ecosistema, porque todas acaban ahí. Llegan peticiones, respuestas, código de estado, tiempos, cabeceras y cuerpos de respuesta.

Hay una exclusión que merece mención aparte: el **`fetch` nativo de Expo**. Desde el SDK 52, Expo instala su propia implementación de `fetch` como global, escrita en código nativo, que nunca toca el módulo de red de React Native, así que no emite ningún evento CDP. Si trabajas con Expo y quieres que una llamada se observe, usa `XMLHttpRequest` o `axios` en lugar del `fetch` global. Esto se midió contra una build real, no se dedujo: la misma petición es invisible por `fetch` y se reporta entera por `XMLHttpRequest`.

Como siempre, las peticiones de WebView, las llamadas de SDK nativos y cualquier cosa que abra sus propios sockets siguen siendo invisibles.

### Apps nativas

Una app Android o iOS normal no expone un punto de enganche equivalente, así que no hay nada a lo que conectarse. Ese caso necesita el adaptador dentro de la app (o un proxy MITM, que Astur deliberadamente no incluye — consulta [La interceptación todavía no está disponible](#la-interceptación-todavía-no-está-disponible)).

## Cómo se usa

Pregunta siempre antes de afirmar. `capabilities()` responde en todas las plataformas, así que el spec sigue siendo portable:

```ts
import { expect, test } from './fixtures.js';

test('el login envía las credenciales', async ({ app, device }) => {
  const capabilities = await device.network.capabilities();
  test.skip(!capabilities.observe, capabilities.coverage);

  await device.network.clear();
  await app.login.signIn('qa@astur.dev', 'Astur12345');

  const [request] = await device.network.requests({ url: '/api/session' });
  expect(request).toMatchObject({ method: 'POST', status: 201 });
  expect(request.durationMs).toBeLessThan(2_000);
});
```

Usar `test.skip()` con `capabilities.coverage` hace que una plataforma sin soporte informe de *por qué* se saltó el test, en vez de pasar sin más.

### La API

```ts
// ¿Qué puede ver realmente esta sesión?
const capabilities = await device.network.capabilities();
// { observe, intercept, transports, responseBodies, coverage, adapterRequired }

// Todo lo capturado hasta ahora, lo más reciente al final.
const all = await device.network.requests();

// Filtra por url (subcadena o expresión regular), método o transporte.
const posts = await device.network.requests({ url: /\/api\//, method: 'POST' });

// Abre una ventana de captura nueva a mitad del test.
await device.network.clear();
```

Cada registro trae `method`, `url`, `status`, `requestHeaders`, `responseHeaders`, `startedAt`, `durationMs` y `error` cuando el intercambio falló antes de completarse.

### Comportamientos por defecto en los que puedes confiar

- **Las cabeceras con credenciales se ocultan.** `authorization`, `cookie`, `set-cookie` y `x-api-key` se convierten en `<redacted>` antes de que el registro te llegue: el tráfico capturado acaba en logs de CI e informes HTML.
- **Los cuerpos tienen un tope** de 64 KiB, y se descartan con `bodyOmittedReason: 'too-large'`, para que una ejecución larga no acumule megabytes de contenido.
- **El búfer se limpia entre tests**, así que un test nunca puede afirmar sobre el tráfico de otro.

Sobrescríbelo por llamada cuando lo necesites:

```ts
await device.network.requests({ url: '/api' }, {
  maxBodyBytes: 4096,
  redactHeaders: ['x-tenant-token']
});
```

### Una lista vacía significa «no hubo tráfico»

Donde la observación no está disponible, `requests()` **lanza** `NETWORK_OBSERVATION_UNSUPPORTED` en lugar de devolver `[]`. Una lista vacía tiene que significar «no se pidió nada»; si no, `expect(requests).toHaveLength(0)` pasaría en todas las plataformas que sencillamente no pueden ver.

## La interceptación todavía no está disponible

`capabilities().intercept` es `false` en todas partes, y `adapterRequired` explica por qué. Simular, retrasar o hacer fallar una petición implica mantenerla abierta; un perfilador solo informa de lo que ya ocurrió.

Eso necesita un pequeño adaptador opcional dentro de la app, que es la siguiente fase. Astur deliberadamente **no** incluye un proxy MITM para fingirlo:

- Android 7+ ignora las CA instaladas por el usuario salvo que la app lo permita en `network_security_config`.
- El `HttpClient` de Dart ignora por completo el proxy del sistema salvo que la app defina `findProxy`.

Es decir, un proxy exige cambios en la app *de todos modos*, y encima añade caducidades de certificado y fallos de TLS como formas nuevas de romper tests que no tienen nada que ver. Un adaptador explícito es la versión honesta del mismo requisito.

## Pruébalo

La tarjeta **Network lab** de la pantalla de inicio de la app de demostración en Flutter maneja una API en loopback que ella misma sirve: HTTP real, sin internet y determinista.

```bash
cd examples
npm run test:android:flutter -- specs/network-observation.test.ts
```

La app de demostración en React Native ejecuta **el mismo spec, sin cambios**, contra una build debug:

```bash
# en el repositorio de la app de demostración
npx expo start                       # sirve también las rutas /api del Network lab
npx expo run:android                 # o: npx expo run:ios

# en examples
npm run test:android:rn-debug        # o: npm run test:ios:rn-debug
```

Su Network lab responde en las mismas tres rutas y con los mismos códigos que la build de Flutter — `/api/profile` 200, `/api/session` 201, `/api/missing` 404 —, que es lo que permite que un único spec independiente de plataforma cubra ambas.

La build **release** de React Native que se distribuye tiene el reportero excluido en compilación, así que allí `capabilities().observe` es `false` y los cuatro specs de observación se saltan indicando el motivo. Eso es el contrato funcionando, no un fallo.

Una trampa que conviene conocer: la configuración release de iOS no fuerza la reinstalación, así que una build debug que se quedó en el simulador se sigue usando, y sigue observando. Ejecuta `xcrun simctl uninstall <udid> com.astur.demo` antes de volver atrás.

Consulta [Flutter y React Native](../frameworks/) para el detalle específico de cada framework, y [Límites de plataforma](../platform-limits/) para la referencia completa.
