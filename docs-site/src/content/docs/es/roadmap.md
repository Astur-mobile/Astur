---
title: "Hoja de ruta"
description: "Lo que ya está hecho, lo que falta y en qué orden viene lo siguiente."
sidebar:
  order: 11
---
Esta página recoge qué falta todavía para llegar al objetivo de la arquitectura basada en agentes nativos:

```text
API de tests sencilla, al estilo Playwright
  -> núcleo de Astur
  -> driver de plataforma de Astur
  -> agente nativo persistente de la plataforma
  -> UiAutomator / XCUITest
```

## Implementado

### Escritura de tests

- **Localizadores componibles** (sin publicar todavía): acota una búsqueda a un elemento padre, filtra con `filter({ hasText, hasNotText, has, hasNot })`, combina con `and()` y `or()`, y elige con `first()`, `last()` y `nth(i)`. La composición se resuelve contra una única instantánea del árbol en el host, en lugar de empujarse a los agentes, lo que deja intacto el selector que recibe el driver y no exige ningún cambio en el protocolo del agente en ninguna de las dos plataformas. Cuando un localizador compuesto acaba en un elemento identificable por sí solo, se envía al driver su selector simple, de forma que el comportamiento coincide con el de un localizador normal en vez de degradarse a coordenadas.
- **Lectores de estado y comodidades del localizador** (0.5.0-beta): `textContent()`, `inputValue()`, `bounds()`, `count()`, `isEnabled()` / `isDisabled()` / `isSelected()` / `isFocused()`, `clear()` y `waitFor({ state })` al estilo Playwright.
- **`getByPlaceholder()`, `isChecked()` e `isEmpty()`** (sin publicar todavía), con los matchers `toBeChecked` y `toBeEmpty`. El estado de marcado tiene tres valores: un elemento que no informa de ninguno queda como *desconocido*, no como `false`.
- **`by.native({ ios, android })` — la vía de escape a selectores nativos en crudo** (0.5.0-beta), para ese elemento raro que `by.label`, `by.id`, `by.text`, `by.role` y `by.type` no pueden expresar. `ios` es una cadena `NSPredicate` de XCUITest en crudo: la gramática declarativa de consultas de la propia Apple, no código ejecutable. `android` es una cadena estructurada (`className`, `textContains`, `resourceId`, `hasChild`, `hasDescendant`, …) construida enteramente con la API fluida `By`/`BySelector` de androidx.test.uiautomator, y deliberadamente no es un lenguaje de expresiones arbitrario: sin `eval`, sin analizador propio y sin compilador. Un campo opcional `instance` elige la coincidencia n-ésima en ambas plataformas. Requiere un agente nativo conectado. La estrategia `xpath` sigue reservada y sin implementar; su mensaje de error apunta aquí.
- **Búsqueda nativa de múltiples coincidencias en Android** (0.5.0-beta): el agente UIAutomator atiende `element.findAll` y `element.findMany`, así que `queryAll()`, `count()`, `device.findAll()` y `device.findMany()` se resuelven en el dispositivo en una sola ida y vuelta, en lugar de descargar el árbol de interfaz completo. Los agentes ya instalados más antiguos vuelven automáticamente al camino anterior; el agente de iOS ya atendía ambos comandos.

### Qué se puede probar

- **Flutter** en ambas plataformas: el servicio Dart VM (árbol de widgets en vivo) en Android, y el árbol de accesibilidad de XCUITest en iOS, con una coincidencia parcial en el agente sobre las etiquetas fusionadas de Flutter.
- **Control del DOM en WebViews internas** mediante `device.webContext()`: un puente de JavaScript inyectado, independiente del motor, que maneja WebViews de Flutter y React Native. Android (Chromium/CDP) e iOS en **simulador y dispositivos reales** (WKWebView vía `ios-webkit-debug-proxy`; el simulador se conecta automáticamente por su socket `webinspectord_sim`). El Inspector inserta el DOM de la WebView en el árbol de interfaz con localizadores reales y con `fill` y `tap`.
- **Web móvil** (0.6.0-beta): `device.browser` maneja una página en el navegador del propio dispositivo — Chrome en Android, Safari en iOS. Una configuración con `browser` y sin `app` crea una sesión solo de navegador que no instala nada y trata el agente nativo como opcional. Android obtiene una pestaña por test; iOS reutiliza una y la recarga, porque WebKit no expone el ciclo de vida de las pestañas.
- **Observación de red** (0.5.0-beta.5): `device.network` informa del tráfico HTTP de la app — el dominio `Network` de CDP para React Native en ambas plataformas, y el perfilador HTTP de la Dart VM para Flutter. La cobertura se anuncia mediante `capabilities()`, de modo que un spec se salta a sí mismo con un motivo en vez de fallar donde la observación no está disponible.
- **Comparación visual** (0.5.0-beta.5): `toHaveScreenshot()` contra imágenes de referencia por dispositivo, con máscaras, tolerancias y diferencias en imagen dentro del informe HTML. Las referencias se indexan por plataforma, motor de renderizado y tamaño de pantalla.

### Dispositivo y herramientas

- **Introspección de app y dispositivo** (sin publicar todavía): `device.app.list()`, `device.app.foreground()` y `device.orientation.get()`.
- **`astur screenshot`** (sin publicar todavía) captura la pantalla de un dispositivo en un PNG sin escribir ningún test.
- **Endurecimiento del Inspector y codegen** (0.5.0-beta): el compositor de aserciones registra el conjunto completo de matchers, los gestos de arrastre se graban en el código generado, las acciones de `fill` y `expect` sin localizador se rechazan en lugar de emitir código roto, la exportación sale en TypeScript o JavaScript, y la apertura automática del navegador ya no rompe la CLI en Windows (#10).
- Los agentes de Android e iOS devuelven diagnósticos estructurados de tiempos y fallos por el protocolo común; los fallos de accionabilidad incluyen el selector, la instantánea del elemento candidato y su estado de visibilidad, habilitación, alcanzabilidad y estabilidad allí donde la plataforma lo expone. En el host, `AsturError` conserva ese detalle en lugar de perderlo en la frontera del transporte.
- Un flujo manual de humo en runners autoalojados obliga a usar el camino con agente en Android, en el simulador de iOS y en hardware iOS real firmado.
- **Documentación en árabe** (0.6.0-beta): todas las páginas, en `/ar/`.

## Lo que falta

- **Acciones direccionadas por índice en el camino nativo**: `nth(n).tap()` resuelve el índice en el host, así que una acción sobre un localizador compuesto que no pueda identificarse de forma única acaba recurriendo a coordenadas. Un parámetro de índice de elemento en el protocolo del agente lo mantendría nativo de extremo a extremo. El campo `instance` de `by.native()` resuelve esto hoy para el caso concreto de la vía de escape.
- **`fill()` sobre un localizador compuesto** que acaba en un elemento no identificable: toca para dar el foco y escribe, lo que no permite vaciar el campo antes. Se informa como `COMPOSED_LOCATOR_FILL_UNSUPPORTED` donde ni siquiera eso está disponible.
- **Cobertura de gestos y entrada**: todavía no hay gestos de pellizco y zoom, y `clear()` sigue pasando por `fill('')`. Un comando nativo específico para borrar texto sería más fiel en ambas plataformas.
- **App en primer plano en iOS**: no lo informan ni `simctl` ni `devicectl`, y el runner de XCTest está limitado a la app que él mismo lanzó. Android lo lee de `dumpsys`.
- **Dirección de la orientación en iOS**: se deduce de la geometría del viewport, así que no se distinguen las dos orientaciones horizontales.
- **Arrastrar y soltar en Flutter sobre iOS**: solo el primer arrastre sintético de XCUITest de una secuencia llega al reconocedor de pan de Flutter; hace falta un inyector de arrastre en varios pasos (eventos de movimiento reales) para igualar al driver de Dart VM en Android.
- **Dispositivos iOS reales para el destino de navegador**: el camino de código existe (`devicectl` y Safari), pero no se ha ejecutado contra hardware físico.
- **Aislamiento del almacenamiento del navegador**: una pestaña no es un browser context de Playwright, y ninguna de las dos plataformas ofrece un perfil por pestaña — las cookies y `localStorage` se comparten. Esto es un límite de plataforma, no una tarea pendiente.
- Los entornos de integración continua alojados por defecto no pueden ejecutar hardware móvil real. Los trabajos de humo con iOS firmado y Android físico necesitan runners autoalojados con las etiquetas de dispositivo correspondientes.
- Los informes más profundos de localizadores estrictos, incluidas listas ordenadas de candidatos para cada estrategia, siguen ampliándose.
- La planificación más rica de conjuntos de dispositivos para destinos en la nube y granjas sigue en fase de diseño; la configuración de nube actual es un esqueleto, no un camino de ejecución.
- El Inspector y codegen en dispositivos iOS reales necesitan un flujo compacto del árbol nativo, para que las instantáneas amplias de XCTest no bloqueen el árbol en vivo en pantallas grandes.
- El campo `instance` de `by.native()` en Android selecciona la coincidencia n-ésima después de aplicar todas las restricciones `hasChild` y `hasDescendant`, pero no hay equivalente para anidar «el hijo n-ésimo de un padre concreto» *dentro* de una de esas cláusulas: solo en la raíz de la cadena.

## Siguientes pasos (por orden)

1. Paridad del camino nativo para localizadores compuestos
- Añadir un parámetro de índice de elemento al protocolo del agente para que `nth(n).tap()` y un `fill()` compuesto sigan siendo nativos en vez de recurrir a coordenadas.
- Añadir un comando nativo específico para borrar texto, que el mismo trabajo desbloquea.

2. Diagnósticos y paridad de los agentes
- Mantener alineadas y verificadas por contrato las formas de resultado del protocolo en Android e iOS.
- Ampliar los diagnósticos de candidatos para selectores complejos sin que las acciones normales paguen el coste de descargar el árbol completo.

3. Pulido del camino de interacción atómica
- Mantener búsqueda, espera y acción dentro de un mismo comando nativo en ambas plataformas.
- Ampliar la cobertura de roles y controles como deslizadores, selectores de medios y alertas.
- Añadir gestos de pellizco y zoom.

4. Ejecución en paralelo
- Seguir ampliando los conjuntos de dispositivos para que los selectores poco específicos repartan los workers entre dispositivos locales y remotos de forma automática.
- Mantener los proyectos multiplataforma aislados por identificador de dispositivo y directorio de artefactos.

5. Fiabilidad y telemetría
- Mostrar de forma consistente en los informes los tiempos de cada comando y los metadatos de traza, para que una ejecución inestable revele si el retraso estuvo en el transporte del host, en la búsqueda nativa, en el renderizado de la app o en la ejecución de la acción.
- Añadir tiempos propios del Inspector para el refresco de la captura, el refresco del árbol, la detección de impactos y la grabación de acciones.

6. Cumplimiento en CI y migración
- Mantener en verde el flujo de humo con agente obligatorio en los runners autoalojados de Android e iOS.
- Conservar los caminos alternativos para el desarrollo local hasta que las suites con agente sean lo bastante estables como para hacerlo obligatorio en todas partes.

## La experiencia que buscamos

La API de tests debería seguir siendo sencilla:

```ts
await device.getByRole('button', { name: 'Sign in' }).tap();
await expect(device.getByText('Welcome')).toBeVisible();
```

Todo el transporte, las esperas, la accionabilidad y la complejidad de plataforma deberían quedarse en las capas del runtime y de los agentes nativos.
