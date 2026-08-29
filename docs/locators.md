# Locators

A locator describes *how to find* an element, not the element itself. Nothing is queried until you act on it or assert against it, so a locator stays valid across a screen that redraws underneath it.

```ts
await device.getByRole('button', { name: 'Sign In' }).tap();
```

## Finding one element

| Factory | Matches |
| --- | --- |
| `getByTestId(id)` | Accessibility identifier / `resource-id`. The most stable choice |
| `getById(id)` | Same as `getByTestId` |
| `getByLabel(text)` | Accessibility label (`contentDescription` on Android) |
| `getByText(text)` | Visible text |
| `getByRole(role, { name })` | Semantic role, optionally filtered by accessible name |
| `getByType(type)` | Platform element type |
| `getByPlaceholder(text)` | Placeholder / hint of an empty input |

Every factory takes `{ exact: false }` for substring matching, and `getByText` accepts a `RegExp`.

### About `getByPlaceholder`

Neither platform reports a placeholder as a first-class accessibility field, so Astur reads it from the driver's raw attributes where they carry one (`hint` on Android, `placeholderValue` on iOS) and otherwise falls back to the value or label of an **empty** field — which is how a placeholder surfaces on a field nobody has typed into.

The consequence is worth knowing: once the field has content, it no longer matches its own placeholder. That is deliberate. The alternative — matching a field by a placeholder it is no longer showing — makes a test pass while asserting something untrue.

## Narrowing down

A screen full of repeated rows is the normal case in mobile, and no single selector distinguishes them. Compose instead.

### Scoping to a parent

Any locator can search inside another. Lookups are scoped to that parent's descendants — a parent never matches itself.

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

`hasText` and `hasNotText` look at the element **and everything beneath it**, so a row matches on the text of its children. Both take a string (substring) or a `RegExp`.

Filters stack — every one must pass:

```ts
device.getByType('Cell')
  .filter({ hasText: 'In stock' })
  .filter({ hasNot: device.getByText('Pre-order') })
```

### `and()` / `or()`

```ts
device.getByRole('button').and(device.getByLabel('Add'))   // both must match
device.getByText('Retry').or(device.getByText('Try again'))  // either
```

`or()` returns matches in document order and never repeats an element both sides matched.

### Position

```ts
locator.first()
locator.last()
locator.nth(2)
locator.nth(-1)   // negative counts from the end
```

Position is applied **last**, after scoping and filtering. `filter(...).first()` therefore means "the first of the filtered set", not "the first match, if it survives the filter" — which is almost always what you meant.

## Acting and asserting

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

`isChecked()` **throws** rather than returning `false` when the element reports no checked state at all. "This is not a checkable control" and "it is unchecked" are different facts, and quietly merging them turns a mis-aimed locator into a passing assertion.

Matching assertions retry until satisfied or timed out:

```ts
await expect(locator).toBeVisible();
await expect(locator).toBeChecked();
await expect(locator).toBeEmpty();
await expect(locator).toHaveText('Welcome back');
await expect(locator).toHaveCount(3);
```

## Limitations

| Limitation | Why |
| --- | --- |
| **Composed locators cost one extra tree read** | A refinement is relative to a whole tree, so it is resolved against a single snapshot rather than pushed down to the driver. Plain locators still take the driver's fast path unchanged |
| **`fill()` on a composed locator needs the element to be nameable** | When the resolved element carries a unique id, label, or text, Astur hands the driver that plain selector and behaves identically. When nothing distinguishes it — a field in one of several identical rows — it taps to focus and types, which cannot clear the field first. Reported as `COMPOSED_LOCATOR_FILL_UNSUPPORTED` where even that is unavailable |
| **Checked state is not reported by every driver** | Android reads it from `checkable`/`checked`. Elsewhere it is derived from a toggle's value string. An element that answers neither reports *unknown* |
| **`by.xpath` is reserved, not implemented** | Use `by.native({ ios, android })` for what the semantic factories cannot express |

## Escape hatch

When no semantic locator can express the target — usually a screen with no accessibility metadata — `by.native()` passes a platform query straight to the agent:

```ts
device.find(by.native({
  ios: "type == 'Button' AND label CONTAINS 'Save'",
  android: { className: 'android.widget.Button', textContains: 'Save' }
}));
```

Android's variant also supports `hasChild` / `hasDescendant` for structural matching. Prefer composition above; reach for this when the tree carries nothing semantic to compose on.
