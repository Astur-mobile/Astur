# Localizadores

Un localizador describe *cómo encontrar* un elemento, no el elemento en sí. No se consulta nada hasta que actúas sobre él o haces una aserción, así que un localizador sigue siendo válido aunque la pantalla se redibuje por debajo.

```ts
await device.getByRole('button', { name: 'Sign In' }).tap();
```

## Encontrar un elemento

| Función | Coincide con |
| --- | --- |
| `getByTestId(id)` | Identificador de accesibilidad o `resource-id`. La opción más estable |
| `getById(id)` | Igual que `getByTestId` |
| `getByLabel(text)` | Etiqueta de accesibilidad (`contentDescription` en Android) |
| `getByText(text)` | Texto visible |
| `getByRole(role, { name })` | Rol semántico, opcionalmente filtrado por nombre accesible |
| `getByType(type)` | Tipo de elemento de la plataforma |
| `getByPlaceholder(text)` | Texto de marcador de posición de un campo vacío |

Todas aceptan `{ exact: false }` para coincidencia parcial, y `getByText` admite una expresión regular.

### Sobre `getByPlaceholder`

Ninguna de las dos plataformas expone el marcador de posición como un campo de accesibilidad de primera clase, así que Astur lo lee de los atributos en crudo del driver cuando los trae (`hint` en Android, `placeholderValue` en iOS) y, si no, recurre al valor o la etiqueta de un campo **vacío**, que es como aparece un marcador de posición en un campo donde nadie ha escrito.

La consecuencia conviene tenerla presente: en cuanto el campo tiene contenido, deja de coincidir con su propio marcador de posición. Es deliberado. La alternativa — hacer coincidir un campo por un texto que ya no muestra — hace que un test pase mientras afirma algo que no es cierto.

## Acotar la búsqueda

Una pantalla llena de filas repetidas es lo normal en móvil, y ningún selector suelto las distingue. La solución es componer.

### Acotar a un elemento padre

Cualquier localizador puede buscar dentro de otro. La búsqueda se limita a los descendientes de ese padre: un padre nunca se encuentra a sí mismo.

```ts
const row = device.getByType('Cell').filter({ hasText: 'Rye' });
await row.getByRole('button', { name: 'Add' }).tap();
```

### `filter()`

```ts
locator.filter({ hasText: 'In stock' })
locator.filter({ hasNotText: /sold\s+out/i })
locator.filter({ has: device.getByRole('button') })
locator.filter({ hasNot: device.getByText('Ad') })
```

`hasText` y `hasNotText` miran el elemento **y todo lo que cuelga de él**, así que una fila coincide por el texto de sus hijos. Ambos aceptan una cadena (coincidencia parcial) o una expresión regular.

Los filtros se acumulan: todos tienen que cumplirse.

```ts
device.getByType('Cell')
  .filter({ hasText: 'In stock' })
  .filter({ hasNot: device.getByText('Pre-order') })
```

### `and()` y `or()`

```ts
device.getByRole('button').and(device.getByLabel('Add'))   // se cumplen las dos
device.getByText('Retry').or(device.getByText('Try again'))  // cualquiera de las dos
```

`or()` devuelve las coincidencias en el orden del árbol y nunca repite un elemento que encajaba en ambos lados.

### Posición

```ts
locator.first()
locator.last()
locator.nth(2)
locator.nth(-1)   // los negativos cuentan desde el final
```

La posición se aplica **al final**, después de acotar y filtrar. Por eso `filter(...).first()` significa «el primero del conjunto filtrado» y no «la primera coincidencia, si sobrevive al filtro», que es casi siempre lo que querías decir.

## Actuar y afirmar

```ts
await locator.tap()
await locator.doubleTap()
await locator.longPress({ durationMs: 1000 })
await locator.fill('qa@astur.dev')
await locator.clear()
await locator.dragTo(target)
await locator.scrollIntoView()
await locator.screenshot()
```

```ts
await locator.count()
await locator.all()
await locator.isVisible()
await locator.isEnabled()
await locator.isChecked()
await locator.isEmpty()
await locator.textContent()
await locator.inputValue()
await locator.bounds()
await locator.waitFor({ state: 'visible' })
```

`isChecked()` **lanza un error** en lugar de devolver `false` cuando el elemento no informa de ningún estado de marcado. «Esto no es un control marcable» y «esto está desmarcado» son hechos distintos, y confundirlos en silencio convierte un localizador mal apuntado en una aserción que pasa.

Las aserciones reintentan hasta cumplirse o agotar el tiempo:

```ts
await expect(locator).toBeVisible();
await expect(locator).toBeChecked();
await expect(locator).toBeEmpty();
await expect(locator).toHaveText('Welcome back');
await expect(locator).toHaveCount(3);
```

## Límites

| Límite | Por qué |
| --- | --- |
| **Un localizador compuesto cuesta una lectura extra del árbol** | La composición es relativa al árbol entero, así que se resuelve contra una única instantánea en lugar de empujarse al driver. Los localizadores simples siguen usando el camino rápido del driver sin cambios |
| **`fill()` sobre un localizador compuesto necesita que el elemento sea identificable** | Cuando el elemento resuelto tiene un id, etiqueta o texto únicos, Astur entrega al driver ese selector simple y se comporta igual. Cuando no lo distingue nada — un campo dentro de una de varias filas idénticas — toca para dar el foco y escribe, lo que no permite vaciar el campo antes. Se informa como `COMPOSED_LOCATOR_FILL_UNSUPPORTED` cuando ni eso está disponible |
| **No todos los drivers informan del estado de marcado** | Android lo lee de `checkable` y `checked`. En el resto se deduce del valor del control. Un elemento que no responde a ninguno queda como *desconocido* |
| **`by.xpath` está reservado, no implementado** | Usa `by.native({ ios, android })` para lo que las funciones semánticas no puedan expresar |

## Vía de escape

Cuando ningún localizador semántico expresa el objetivo — normalmente una pantalla sin datos de accesibilidad — `by.native()` pasa una consulta específica de la plataforma directamente al agente:

```ts
device.find(by.native({
  ios: "type == 'Button' AND label CONTAINS 'Save'",
  android: { className: 'android.widget.Button', textContains: 'Save' }
}));
```

La variante de Android admite además `hasChild` y `hasDescendant` para coincidencias estructurales. Es preferible componer como se explica arriba; recurre a esto cuando el árbol no traiga nada semántico sobre lo que componer.
