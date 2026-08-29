# Configuración de iOS

La automatización de iOS solo funciona en macOS. Astur usa las propias herramientas de Apple en lugar de un servidor Appium:

- `simctl` para el ciclo de vida del simulador
- `devicectl` para el ciclo de vida de dispositivos reales
- `xcodebuild` para arrancar el runner de XCUITest en Swift incluido
- el agente XCUITest de Astur para búsqueda nativa, esperas, gestos, capturas y control del teclado

Astur arranca el agente incluido automáticamente. No deberías compilarlo ni instalarlo a mano para ejecuciones locales normales, pero los dispositivos iOS reales siguen necesitando un equipo de firma de Apple, porque los runners de XCTest tienen que ir firmados. Para dispositivos reales conectados por USB, Astur prefiere el túnel de Xcode/CoreDevice para el puente con el host antes de recurrir a una dirección de red local.

Cuando todo está en su sitio, `codegen` transmite un espejo del dispositivo en vivo, el árbol de interfaz completo y localizadores listos para pegar:

![El Inspector de Astur contra un simulador de iOS: espejo del dispositivo en el centro, árbol de XCUITest a la derecha y localizadores generados a la izquierda.](./images/inspector-ios-simulator.png)

## Requisitos de un vistazo

| Qué necesitas | Simulador de iOS | iPhone / iPad real |
| --- | :---: | :---: |
| macOS y Xcode (abierto una vez, licencia aceptada) | Obligatorio | Obligatorio |
| Herramientas de línea de comandos: `xcrun`, `simctl`, `xcodebuild` | Obligatorio | Obligatorio |
| **Runtime de simulador** de iOS (Xcode → Ajustes → Plataformas) | Obligatorio | — |
| `devicectl` (viene con Xcode) | — | Obligatorio |
| **Artefacto de la app** | **`.app`** compilada para simulador | **`.ipa`** firmada para el dispositivo |
| **Equipo de firma de Apple** (`ASTUR_IOS_DEVELOPMENT_TEAM`) | No hace falta | **Obligatorio** |
| Dispositivo de confianza para el Mac y **Modo Desarrollador** activo | — | Obligatorio |
| Agente XCUITest | Se compila y arranca solo | Se compila, **se firma** y arranca solo |

> **Nunca instalas ni aprovisionas el agente a mano.** Astur compila y lanza el runner de XCUITest en Swift incluido mediante Xcode en cada sesión, y reutiliza una compilación en caché (`DerivedData`) en ejecuciones posteriores. En dispositivos reales además lo *firma* con tu equipo de Apple: el único paso extra que los simuladores se ahorran. La regla del artefacto es lo que hay que recordar: **simulador = `.app`, dispositivo real = `.ipa`.**

## Preparación del equipo

Instala Xcode, ábrelo una vez, acepta las licencias e instala los componentes que pida.

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
npx astur-mobile doctor
```

## Elige un camino

Escoge la configuración de iOS más pequeña que encaje con lo que quieres hacer:

| Objetivo | ¿Compilar tu app antes? | Artefacto | ¿Firma de Apple? | Comando |
| --- | --- | --- | --- | --- |
| Probar Astur en un simulador con la app de demostración | No (descarga la `.app` de demostración) | `Astur.app` | No | `npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo` |
| Inspeccionar o probar tu propia app en un simulador | Sí | `.app` de simulador | No | `npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp` |
| Inspeccionar o probar en un iPhone o iPad real | Sí | `.ipa` firmada | Sí | `npx astur-mobile codegen --ios --real --device <udid> --app ./MyApp.ipa --app-id com.example.myapp` |

> ¿Quieres una app lista para probar primero? La app de demostración de Astur (`Astur.app` para simuladores, `astur.demo.ios.ipa` para dispositivos reales, bundle id `com.astur.demo`) viene en el repositorio de ejemplos. Descárgala y apunta `--app` a ella, o sustitúyela por tu propia compilación.

## Preparación del simulador

Sin firma de Apple ni certificados: es la forma más rápida de empezar.

**Paso 1 — Instala un runtime de simulador** (una vez): Xcode → **Ajustes → Plataformas** → añade un runtime de iOS.

**Paso 2 — Comprueba que la cadena de herramientas ve un simulador:**

```bash
xcrun simctl list devices available
npx astur-mobile devices --ios
```

**Paso 3 — Lanza el Inspector o codegen.** Apunta `--app` a una `.app` de simulador y pasa su bundle id. Para probar Astur ya mismo, usa la app de demostración descargada; si no, usa tu propia compilación:

```bash
# App de demostración (descarga Astur.app del repositorio de ejemplos)
npx astur-mobile codegen --ios --simulator --app ./Astur.app --app-id com.astur.demo

# Tu propia app
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
```

Se abre una pestaña del navegador automáticamente. En unos segundos deberías ver el espejo del dispositivo en vivo y un árbol de interfaz relleno (como en la captura de arriba). La primera ejecución es más lenta porque Xcode compila el agente una vez; las siguientes reutilizan la compilación en caché.

### Usar tu propia app en un simulador

Para inspeccionar o probar tu propia app en un simulador tienes que compilarla antes. Astur espera una `.app` compilada para simulador desde Xcode y no la compila por ti. Una ruta de salida típica de Xcode está dentro de DerivedData, del estilo `.../Build/Products/Debug-iphonesimulator/MyApp.app`.

Para ejecutar tests, añade Astur a tu configuración de Playwright y lanza `npx astur-mobile test`:

```ts
// playwright.config.ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'ios',
      device: { kind: 'simulator', name: 'iPhone 16' },
      app: {
        path: './build/MyApp.app',
        bundleId: 'com.example.myapp'
      }
    }
  }
});
```

```bash
npx astur-mobile test                 # todos los tests
npx astur-mobile test tests/login.test.ts
```

## Preparación de un dispositivo real

Los dispositivos reales tienen el compromiso contrario: **la firma de Apple es obligatoria.** Se firman dos cosas, y Astur las trata de forma distinta:

1. **Tu app** — tú entregas un `.ipa` firmado para el dispositivo. Astur no firma tu app.
2. **El agente XCUITest** — Astur lo compila y lo **firma por ti** al inicio de la sesión, pero Apple exige un equipo de desarrollo para hacerlo. Tú aportas el equipo; Astur se encarga del resto (sin malabares con perfiles de aprovisionamiento).

Nada de esta configuración de firma existe en los simuladores.

**Paso 1 — Prepara el dispositivo:**

1. Conecta el iPhone o iPad por USB.
2. Pulsa **Confiar** en el dispositivo cuando lo pida.
3. Activa el **Modo Desarrollador** (Ajustes → Privacidad y seguridad → Modo Desarrollador) y reinicia.
4. Añade tu cuenta de Apple Developer en **Xcode → Ajustes → Cuentas**.

**Paso 2 — Indica el equipo de firma.** Es la única variable obligatoria para dispositivos reales:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345   # tu Team ID de Apple, de 10 caracteres
```

> Encuentra tu Team ID en Xcode → Ajustes → Cuentas → tu equipo, o en [developer.apple.com](https://developer.apple.com/account) → Membership. Si trabajas desde el repositorio fuente, Astur también puede deducirlo de `agents/ios-xctest-agent/AsturIOSAgent.xcodeproj` cuando ese proyecto ya está firmado en Xcode; pero para instalaciones desde npm y para CI, define siempre `ASTUR_IOS_DEVELOPMENT_TEAM` de forma explícita. Astur firma el agente con aprovisionamiento automático (`-allowProvisioningUpdates`); define `ASTUR_IOS_CODE_SIGN_IDENTITY` solo si tu entorno necesita una identidad concreta.

**Paso 3 — Asegúrate de que tu `.ipa` está firmada para este dispositivo.** El perfil de aprovisionamiento de la app debe incluir el UDID del dispositivo. Si no, la instalación o el arranque fallan con `IOS_APP_INSTALL_SIGNATURE_INVALID`.

**Paso 4 — Puente con el host (normalmente automático).** Astur anuncia el túnel USB de Xcode/CoreDevice al agente del dispositivo de forma automática. Define una IP de red local del Mac solo si el teléfono no alcanza el puente detectado:

```bash
export ASTUR_IOS_AGENT_HOST=192.168.0.14
```

> La primera ejecución en dispositivo real puede tardar **varios minutos** mientras Xcode compila y firma el agente. Las siguientes reutilizan la compilación en caché y arrancan en segundos.

Verifica el dispositivo:

```bash
xcrun devicectl list devices
npx astur-mobile devices --ios
```

`doctor` debería informar del dispositivo real conectado, de un equipo de firma configurado y del proyecto del agente XCUITest incluido:

```bash
npx astur-mobile doctor --verbose
```

Configuración para dispositivo real:

```ts
import { defineConfig } from '@astur-mobile/test';

export default defineConfig({
  testDir: './tests',
  use: {
    astur: {
      platform: 'ios',
      device: {
        kind: 'real',
        id: '00008030-000548220EF0802E'
      },
      app: {
        path: './build/MyApp.ipa',
        bundleId: 'com.example.myapp'
      }
    }
  }
});
```

Después ejecuta la suite con la CLI publicada:

```bash
export ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345
npx astur-mobile test
```

`bundleId` se puede deducir de una `.app` o `.ipa` local cuando la app contiene un `Info.plist` legible, pero definirlo de forma explícita sigue siendo recomendable en CI. Asegúrate de que el `.ipa` está firmado para el dispositivo conectado; si no, la instalación falla con `IOS_APP_INSTALL_SIGNATURE_INVALID`.

## Valores por defecto

Astur usa valores por defecto adaptados al sistema en iOS:

```ts
automation: {
  engine: 'agent',
  legacyFallback: 'never',
  startupTimeoutMs: 60_000,
  commandTimeoutMs: 15_000
},
agent: {
  mode: 'required',
  install: true
}
```

Normalmente los omitirás. Sobrescríbelos solo cuando estés depurando un endpoint de agente propio o un equipo de CI lento.

## Teclado y `fill`

El relleno de texto en iOS usa `typeText` de XCTest para valores seguros y cortos, y una vía basada en pegado para reemplazos largos no seguros. Así los campos de contraseña siguen siendo fiables y se evita la escritura lenta tecla a tecla para textos largos.

```ts
await device.getByTestId('forms-main-input').fill('Astur native form automation');
await device.keyboard.hide();
await device.keyboard.show(device.getByTestId('forms-main-input'));
```

El pegado también está disponible como opción explícita para campos no seguros:

```ts
await device.getByLabel('Bio').fill('Long local-only text', { textInputMode: 'paste' });
```

### Escribir en un control que el árbol no puede describir

Algunos controles no tienen ningún elemento que rellenar. El caso habitual es un campo OTP de varias casillas: las casillas visibles son vistas planas y el `UITextField` real que hay detrás nunca se expone a XCUITest, así que `getByType('textField')` no encuentra nada y `fill()` no tiene objetivo.

`device.keyboard.type()` escribe en lo que tenga el **foco del teclado** en ese momento, así que funciona donde el relleno basado en elementos no puede. Dale el foco al control primero — tocar una casilla suele bastar:

```ts
await device.getByTestId('otp-input').tap();
await device.keyboard.type('123456');
```

La misma llamada funciona en Android, que envía los caracteres a la vista con foco. Un flujo dígito a dígito también es portable, ya que `pressKey` acepta un único carácter imprimible en ambas plataformas:

```ts
for (const digit of '123456') {
  await device.pressKey(digit);
}
```

Dos cosas que conviene saber antes de recurrir a esto:

- **Prefiere `fill()` siempre que el campo sea direccionable.** `fill()` resuelve el elemento, lo vacía y verifica que el valor llegó. `keyboard.type()` apunta al foco, así que nada confirma dónde fueron los caracteres: ese es el precio de alcanzar un control que el árbol no puede describir.
- **El teclado tiene que estar visible.** Sin teclado en pantalla no hay nada con foco donde escribir, y el agente falla con `KEYBOARD_NOT_VISIBLE` en lugar de no hacer nada en silencio.

El comportamiento global del teclado se puede configurar:

```ts
use: {
  astur: {
    platform: 'ios',
    keyboard: {
      dismiss: 'auto'
    }
  }
}
```

## Rendimiento y estabilidad

La automatización nativa de iOS pasa por XCTest. Cada toque, relleno, deslizamiento y arrastre espera a que la app quede en reposo (sin trabajo pendiente de UIKit o CoreAnimation) antes y después del evento. Eso es lo que mantiene fiable a XCTest, pero también significa que cualquier cosa que mantenga la app animándose hace que las acciones vayan lentas o parezcan colgadas hasta que expira el comando. Dos ajustes del dispositivo eliminan las causas más habituales. Aplícalos una vez en el simulador o dispositivo donde pruebas.

**Desactiva el autorrelleno de contraseñas.** Al enfocar un campo seguro o con aspecto de inicio de sesión, iOS muestra el diálogo de contraseña segura o autorrelleno sobre el teclado. Aparece y desaparece con animación repetidamente, lo que mantiene la app fuera de reposo y hace lento el `fill` en esos campos aunque el valor acabe escribiéndose. Desactívalo en los dispositivos de prueba:

```text
Ajustes > Contraseñas > Opciones de contraseñas > Autorrellenar contraseñas  ->  desactivado
```

**Activa Reducir movimiento.** Unas animaciones de UIKit más cortas dejan que XCTest llegue antes al estado de reposo, lo que acelera los gestos y evita bloqueos largos en transiciones animadas como los efectos de encaje al arrastrar y soltar:

```text
Ajustes > Accesibilidad > Movimiento > Reducir movimiento  ->  activado
```

Recomendaciones adicionales:

- Expón identificadores de accesibilidad estables para cada control con el que interactúes. `getByTestId` y `getById` resuelven en una sola consulta; enumerar texto o roles de forma amplia es intrínsecamente más lento, sobre todo en dispositivos reales.
- Mantén cortas o no cíclicas las animaciones propias de las pantallas bajo prueba. Una vista que se anima sin parar nunca deja que XCTest llegue al reposo, así que la siguiente acción espera el tiempo completo del comando antes de fallar.
- Los reemplazos largos no seguros usan pegado para evitar la entrada lenta tecla a tecla. Los campos seguros siempre teclean, y `{ textInputMode: 'type' }` fuerza la entrada tecla a tecla cuando una app rechaza el pegado.

## El Inspector en iOS

`codegen` lanza el Inspector de Astur: espejo del dispositivo en vivo, árbol de interfaz de XCUITest, generación de localizadores haciendo clic y grabación de pasos que exporta un test listo para ejecutar (como se ve al principio de esta página). Consulta [Inspector y codegen](../inspector/) para el recorrido completo panel a panel.

Arranca codegen con una ruta de app y un bundle id que encajen con tu destino:

```bash
# Simulador (.app, sin firma)
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp

# Dispositivo real (.ipa, necesita ASTUR_IOS_DEVELOPMENT_TEAM)
npx astur-mobile codegen --ios --real --device <udid> --app ./MyApp.ipa --app-id com.example.myapp
```

Para apuntar a un simulador o dispositivo concreto en lugar de al primero que encaje, añade `--device <udid>` (busca los UDID con `npx astur-mobile devices --ios`).

### Comprueba que funciona

La sesión está sana cuando, en la pestaña del navegador que se abre:

1. La etiqueta de estado pasa a **Live** (arriba a la izquierda, en verde).
2. El panel central muestra un **espejo en vivo** de la pantalla del dispositivo.
3. El panel derecho **UI TREE** se llena de elementos.
4. Al hacer clic en un elemento (o en un nodo del árbol) aparecen sugerencias de localizador a la izquierda.

Si la etiqueta se queda en **Connecting…** o el espejo no aparece nunca, consulta [Resolución de problemas → El Inspector nunca llega a estar listo](../troubleshooting/).

### Si falta la app o el agente

Regla práctica para elegir el comando:

- Primera ejecución o app aún no instalada: incluye `--app` para que Astur pueda instalarla antes de conectarse.
- App ya instalada: basta con `--app-id`.
- Si la app falta y solo pasas `--app-id`, Astur devuelve `IOS_APP_NOT_INSTALLED`.

Comandos de ejemplo:

```bash
# Simulador: instalar y conectar en un solo comando.
npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp

# Dispositivo real: instalar y conectar en un solo comando.
ASTUR_IOS_DEVELOPMENT_TEAM=ABCDE12345 \
npx astur-mobile codegen --ios --real --device <udid> --app ./MyApp.ipa --app-id com.example.myapp

# App ya instalada, sin indicar la ruta.
npx astur-mobile codegen --ios --simulator --app-id com.example.myapp
```

Comportamiento del agente de iOS de Astur:

- No hace falta ningún paso manual de instalación del agente, ni en simulador ni en dispositivo real.
- Astur arranca automáticamente el runner de XCUITest en Swift incluido para cada sesión.
- Tanto en simulador como en dispositivo real, el espejo, el árbol de interfaz, las capturas y las interacciones nativas los sirve el agente XCUITest una vez arrancado y enlazado al bundle id de destino.
- Los fallos en simulador suelen ser problemas de arranque de Xcode o del runtime.
- Los fallos en dispositivo real suelen requerir ajustes de firma (`ASTUR_IOS_DEVELOPMENT_TEAM`, dispositivo de confianza, llavero desbloqueado).

Para soluciones a fallos concretos, consulta [Resolución de problemas](../troubleshooting/).

### Limpieza automática de sesiones

Astur es dueño del ciclo de vida del agente XCUITest, así que nunca deja una sesión reteniendo tu dispositivo:

- Cada agente corre en su propio grupo de procesos, de modo que una salida normal o un `Ctrl-C` cierran tanto `xcodebuild` como el runner que lanza.
- Antes de arrancar una sesión nueva, Astur limpia cualquier proceso de agente que haya quedado para el mismo proyecto y dispositivo (por ejemplo, tras matar a la fuerza una ejecución anterior). Desactívalo con `ASTUR_IOS_AGENT_REAP=0` si gestionas tú mismo un agente externo compartido.

### Depurar el agente

```bash
# Registra cada comando que el host encola, entrega y para el que recibe respuesta.
ASTUR_IOS_AGENT_TRACE=1 npx astur-mobile codegen --ios --simulator --app ./MyApp.app --app-id com.example.myapp
```

Consulta [Configuración → variables de entorno de iOS](../configuration/) para la lista completa (proyecto y esquema del agente, puertos, ruta de derived data, identidad de firma y rutas de herramientas).

## Transporte con dispositivos reales

La ejecución de Astur en dispositivo real tiene dos conexiones:

| Conexión | La gestiona | Notas |
| --- | --- | --- |
| Ciclo de vida de la app | `devicectl` y el agente XCUITest | `devicectl` instala, desinstala y lista dispositivos. Una vez conectado el agente, el arranque y cierre de la app se enrutan por XCUITest para que el runner y la app sigan atados a la misma sesión. |
| Automatización nativa | Agente XCUITest de Astur | Lee el árbol de interfaz, ejecuta toques, rellenos y deslizamientos, gestiona la orientación y captura pantallas. |
| Puente con el host | Runtime de Astur | Usa el túnel USB de CoreDevice cuando está disponible; si no, recurre a `ASTUR_IOS_AGENT_HOST` o a una dirección alcanzable del Mac. |

Si la salida de XCUITest contiene `Local network prohibited`, mantén el dispositivo conectado por USB y elimina cualquier valor forzado de `ASTUR_IOS_AGENT_HOST` para que Astur pueda usar el túnel de CoreDevice. Fuerza `ASTUR_IOS_AGENT_HOST` solo en entornos donde el teléfono alcance al Mac por red y el permiso de red local esté concedido.

## Operaciones compatibles

| API | Simulador | Dispositivo real | Notas |
| --- | --- | --- | --- |
| `device.app.install()` | Sí | Sí | Usa una `.app` de simulador en simuladores. Usa un `.ipa` firmado en dispositivos reales. Astur desempaqueta el contenido del IPA internamente antes de instalar. |
| `device.app.launch()` | Sí | Sí | Lanza el bundle id configurado. |
| `device.app.terminate()` | Sí | Sí | En dispositivos reales cierra localizando el proceso de la app lanzada. |
| `device.app.reset({ reinstall: true, launch: true })` | Sí | Sí | Reinicio por desinstalar y reinstalar. |
| `device.app.uninstall()` | Sí | Sí | Elimina el bundle id configurado. |
| `device.permissions.grant('camera')` | Sí | No | Usa `simctl privacy`; Apple no expone un control equivalente en dispositivos reales. |
| `device.permissions.revoke('camera')` | Sí | No | Misma limitación que al conceder. |
| `device.setOrientation('landscape')` | Sí | Sí | Se enruta por el agente XCUITest en sesiones de interfaz nativa. |
| `device.orientation.portrait()` | Sí | Sí | Envoltorio de conveniencia. |
| `device.lock()` / `device.unlock()` | Sí | No | Los simuladores admiten control de encendido de pantalla; los dispositivos reales hay que gestionarlos a mano. |
| `device.screenshot()` | Sí | Sí | En dispositivos reales se captura mediante el agente XCUITest. |
| Grabación de vídeo | Sí | No | De momento solo en simulador. Si se activa en un dispositivo real, Astur omite el adjunto de vídeo nativo en lugar de fallar el test. |
| Localizadores y gestos nativos | Sí | Sí | Requieren el agente XCUITest. |
| `locator.scrollIntoView()` | Sí | Sí | Multiplataforma. Desliza dentro del viewport (o de un contenedor indicado) hasta que el elemento es visible. Consulta la documentación de Android para las opciones. |

Para que los dispositivos reales vayan lo más rápido posible, expón identificadores de accesibilidad estables para los controles y los valores dinámicos. XCTest puede tocar y rellenar por id rápidamente, pero una enumeración amplia de texto del estilo «encuentra todos los números visibles en la pantalla» es intrínsecamente más lenta en dispositivos reales.

## Vía de escape a selectores nativos (`by.native`)

Para ese elemento raro que `by.label`, `by.id`, `by.text`, `by.role` y `by.type` no pueden expresar, `by.native()` acepta una cadena `NSPredicate` de XCUITest en crudo, aplicada mediante `app.descendants(matching: .any).matching(NSPredicate(format:))` — la misma gramática declarativa de predicados que usan las propias API de Apple y la estrategia `-ios predicate string` de Appium. Es dato para un lenguaje de consulta restringido, nunca código que se ejecute:

```ts
await device.find(by.native({
  ios: "type == 'Button' AND label CONTAINS[cd] 'Save'"
})).tap();

// Distingue coincidencias idénticas por posición (empezando en 0):
await device.find(by.native({
  ios: "type == 'StaticText' AND label == 'Delete'",
  instance: 2
})).tap();
```

Como `NSPredicate` puede combinar cualquier número de condiciones en una sola cadena (`AND`/`OR`, `CONTAINS`/`BEGINSWITH`/`MATCHES`, insensible a mayúsculas y acentos con `[cd]`), la mayoría de las desambiguaciones se resuelven con un predicado, sin necesidad de índices posicionales.

`by.native()` requiere un agente nativo conectado: no se puede resolver contra una instantánea en caché del árbol, así que una sesión heredada o sin agente lanza `NATIVE_SELECTOR_REQUIRES_AGENT` en lugar de no encontrar nada en silencio. Para apuntar también a Android con el mismo localizador, añade una cadena `android` junto a `ios` — consulta [Android: vía de escape a selectores nativos](../android/#native-selector-escape-hatch-bynative).

## Límites conocidos de Apple

- Las apps de iOS reales y los runners de XCTest deben ir firmados con tu equipo.
- Las alertas del sistema solo se pueden automatizar cuando XCTest las expone al runner de tests.
- El borrado directo de datos o caché por app no es público en iOS; usa el reinicio por desinstalar y reinstalar.
- El bloqueo y desbloqueo y la modificación de permisos en dispositivos reales no son fiables con las herramientas locales públicas.

El código del agente vive en:

```text
agents/ios-xctest-agent/
```

Se enlaza al bundle id de la app, lee el árbol de accesibilidad, ejecuta acciones nativas y devuelve resultados JSON compactos al runtime de Node.js.
