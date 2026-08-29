# Comparación visual

`toHaveScreenshot()` compara el aspecto de la pantalla con una imagen de referencia guardada, de modo que un cambio visual falla el test en vez de pasar desapercibido.

```ts
await expect(app.home.heroCard).toHaveScreenshot('home-hero-card.png');
```

El `expect(page).toHaveScreenshot()` de Playwright necesita un `Page`, y una sesión nativa no lo tiene. Este es el equivalente nativo: Astur captura a través del dispositivo, tapa lo que puede cambiar y compara contra una referencia por dispositivo. Funciona igual en React Native y Flutter, en Android y iOS.

## Para qué molestarse

Las aserciones funcionales comprueban que un elemento está y dice lo correcto. Pasan tan contentas mientras un botón se vuelve invisible sobre su fondo, una tarjeta pierde su espaciado o un icono deja de dibujarse, porque `toBeVisible()` y `toHaveText()` siguen siendo ciertas.

La aserción visual es la que se da cuenta. Merece la pena cuando:

- **El aspecto de un componente es el producto**: un sistema de diseño, un componente con tema, un gráfico.
- **Una refactorización no debería cambiar nada visible.** Cambiar una primitiva de layout o subir la versión de una librería de interfaz es justo donde se cuela un desplazamiento que nadie ve.
- **Un fallo ya fue visual una vez.** Una imagen de referencia es un test de regresión barato para lo que se rompió.

Es la herramienta equivocada para afirmar comportamiento. Prefiere una aserción funcional siempre que pueda expresar lo que quieres decir: es más rápida, sobrevive a un cambio de renderizado de fuentes y dice lo que pretende.

## Qué aspecto tiene un fallo

Cuando una comparación falla, las imágenes esperada, real y de diferencias se adjuntan al informe HTML de Playwright, que las muestra como una comparación visual:

![El informe HTML de Playwright mostrando una discrepancia de imagen para home-hero-card.png. La pestaña Diff está seleccionada y el botón «Open menu» aparece resaltado en rojo, mientras el resto de la tarjeta se atenúa.](./images/visual-comparison-diff.png)

La pestaña **Diff** atenúa todo lo que coincidió y resalta lo que se movió: aquí, solo el botón principal cambió de color. **Side by side** muestra las dos imágenes juntas, que suele ser la forma más rápida de juzgar si el cambio era intencionado:

![El mismo informe en la pestaña Side by side, con la tarjeta esperada de botón turquesa junto a la real de botón azul marino.](./images/visual-comparison-side-by-side.png)

El mensaje de fallo indica la magnitud de la diferencia para que sea útil desde el log de CI, sin abrir el informe:

```
Screenshot home-hero-card.png does not match its baseline: 49888 pixels differ
(6.34% of the image).
Baseline: specs/visual-comparison.test.ts-snapshots/android-native-1080x2424/home-hero-card.png
Re-run with --update-snapshots once you have confirmed the change is intended.
```

## La primera ejecución escribe la referencia

La primera vez no hay referencia, así que la aserción escribe una y **falla**:

```
No baseline yet, so this run wrote one:
  specs/visual-comparison.test.ts-snapshots/android-native-1080x2424/home-hero-card.png
Check the image looks right, commit it, and re-run.
```

Ese fallo es deliberado. Una ejecución que crea una referencia en silencio no ha afirmado nada, y en CI convierte una referencia ausente en un test verde que nunca comparó nada. Mira la imagen, súbela al control de versiones y la siguiente ejecución comparará contra ella.

### Aceptar un cambio intencionado

Vuelve a ejecutar con `--update-snapshots` de Playwright. Los cuatro modos se comportan igual que en Playwright:

| Opción | Qué hace |
| --- | --- |
| *(ninguna)* | Compara. Solo escribe una referencia ausente, y aun así falla. |
| `-u` / `--update-snapshots` | Reescribe las referencias que **difieren**, y pasa. Es la que normalmente quieres. |
| `--update-snapshots=all` | Reescribe todas las referencias, coincidan o no. |
| `--update-snapshots=none` | No escribe nunca. Una referencia ausente falla en lugar de registrarse: el modo para CI, donde el trabajo que debe detectar desviaciones no debería crearlas. |

Un `-u` a secas equivale a `changed`, no a `all`; ambos actualizan una referencia que se ha desviado.

## Compara un elemento, no la pantalla entera

Prefiere un elemento siempre que puedas:

```ts
await expect(app.home.heroCard).toHaveScreenshot('home-hero-card.png');
```

Una referencia de pantalla completa incluye la barra de estado del sistema, cuyo reloj cambia cada minuto y que ningún localizador de la aplicación puede tapar. Ese único detalle basta para que una aserción de pantalla completa falle por motivos que no le importan a nadie.

Las capturas de elemento se recortan de una captura de pantalla completa. Astur escala los límites del elemento a píxeles de la captura por ti, y eso no es trivial en todas partes: Android informa de los límites en píxeles físicos, mientras que iOS los informa en puntos sobre una imagen a 3x.

## Tapa lo que es realmente dinámico

Una marca de tiempo, un contador en vivo, un avatar: tápalo en lugar de relajar el umbral.

```ts
await expect(card).toHaveScreenshot('forms-fields-card.png', {
  mask: [app.forms.textInput, app.forms.mirror]
});
```

Las regiones tapadas se pintan de magenta antes de comparar, así que una máscara mal colocada se ve a simple vista en la imagen adjunta en vez de ocultar una regresión en silencio. Un localizador de máscara que no encuentra nada se omite, porque un elemento que solo aparece a veces es un motivo normal para taparlo.

Recurre a una máscara antes que a un umbral. Un umbral amplio esconde regresiones reales en toda la pantalla; una máscara esconde una región a propósito.

## Las referencias son por dispositivo

Las referencias se guardan en un directorio que nombra la plataforma, el motor de interfaz y el tamaño de pantalla:

```
visual-comparison.test.ts-snapshots/
  android-native-1080x2424/
  android-flutter-1080x2424/
  ios-native-393x852/
  ios-flutter-393x852/
```

La resolución por sí sola no basta. Una build de React Native y otra de Flutter de la misma pantalla no se dibujan igual en el mismo emulador, así que necesitan referencias separadas.

En iOS se distinguen leyendo el paquete `.app` instalado, porque no hay ninguna señal en tiempo de ejecución: XCUITest sirve el mismo árbol de accesibilidad nativo para una app de Flutter que para una de React Native. Por eso una sesión de Flutter en iOS sigue informando `uiEngine: 'native'` a los localizadores mientras sus referencias viven en `ios-flutter-…`.

Si una comparación se ejecuta contra una referencia de otro dispositivo, Astur lo dice en lugar de imprimir un recuento de píxeles:

```
screenshot size does not match the baseline — baseline is 996x790, this run
captured 1083x1191. This usually means the baseline was recorded on a different
device rather than that the UI changed.
```

### Grabar referencias de iOS: fuerza la instalación

En iOS, Astur se salta la instalación cuando el bundle id ya está presente. Las builds de demostración de React Native y de Flutter **comparten el bundle id `com.astur.demo`**, así que la que se instaló primero sigue ejecutándose, y una referencia grabada entonces queda etiquetada con la build que la configuración *nombraba*, no con la que realmente se manejó.

Pasa `ASTUR_IOS_APP_FORCE_INSTALL=1` siempre que grabes o verifiques referencias de iOS:

```bash
ASTUR_IOS_APP_FORCE_INSTALL=1 npm run test:ios -- specs/visual-comparison.test.ts
ASTUR_IOS_APP_FORCE_INSTALL=1 npm run test:ios:flutter -- specs/visual-comparison.test.ts
```

Android no se ve afectado: sus configuraciones ya fuerzan la instalación.

## Tolerancias

Por defecto, cualquier píxel distinto falla, igual que en Playwright. El ruido de color por píxel ya lo absorbe `threshold` (0,2) antes de contar píxeles.

| Opción | Qué hace |
| --- | --- |
| `threshold` | Tolerancia de color por píxel, 0–1. Por defecto `0.2`. |
| `maxDiffPixels` | Número de píxeles distintos permitidos. |
| `maxDiffPixelRatio` | Proporción de píxeles distintos permitida, 0–1. |
| `mask` | Localizadores que se pintan encima antes de comparar. |
| `stabilizeTimeout` | Cuánto esperar a que la pantalla deje de cambiar. Por defecto 1500 ms. |

Si defines `maxDiffPixels` y `maxDiffPixelRatio` a la vez, ambos deben cumplirse, así que subir uno no puede ensanchar el otro en silencio.

**En móvil suele hacer falta un margen.** Redibujar la misma tarjeta después de un scroll o de un cambio del teclado mueve en torno al 0,2 % de sus píxeles, porque el texto cae en posiciones de subpíxel ligeramente distintas. Mide tus propias pantallas en lugar de adivinar:

```ts
await expect(card).toHaveScreenshot('card.png', { maxDiffPixelRatio: 0.01 });
```

Un margen sigue siendo mucho más estricto que relajar `threshold`: un cambio real — color, texto, espaciado — mueve bastante más del 1 % de una tarjeta.

## Animaciones

Antes de comparar, Astur captura repetidamente hasta que dos capturas consecutivas son idénticas, con el tope de `stabilizeTimeout`. Sin eso, una onda, un fundido o un indicador de carga que aún se está asentando acaba grabado como referencia o comparado contra una, y el test falla por motivos ajenos al cambio bajo prueba.

Pon `stabilizeTimeout: 0` para capturar de inmediato.

## Cuando una comparación falla

Las imágenes esperada, real y de diferencias se adjuntan al informe de Playwright, así que puedes ver qué se movió en vez de adivinarlo a partir de un recuento de píxeles.

## Conviene saberlo antes de confiar en esto

Las aserciones visuales son los tests más sensibles al entorno de todo Astur. Les afectan la versión del sistema, el modelo de dispositivo, el renderizado de fuentes y los tiempos de animación, cosas que pueden cambiar sin que tu app cambie.

Eso es una razón para acotarlas bien, no para evitarlas: afirma sobre el componente que te importa, tapa lo que se mueve y mantén referencias por dispositivo. Un puñado de referencias de elementos bien enfocadas detecta regresiones reales y no da guerra. Una pantalla entera de píxeles no hace ninguna de las dos cosas.
