# @astur-mobile/test

Playwright-style test integration for [Astur](https://github.com/Astur-mobile/Astur) — device-native mobile automation for Android and iOS, no Appium server.

```bash
npm install -D @astur-mobile/test astur-mobile @playwright/test
```

> `@playwright/test` is a peer dependency — Astur extends the Playwright Test runner, so your project provides it.

```ts
import { test, expect } from '@astur-mobile/test';

test('login', async ({ device }) => {
  await device.getByLabel('Email').fill('qa@example.com');
  await device.getByRole('button', { name: 'Login' }).tap();
  await expect(device.getByText('Welcome')).toBeVisible();
});
```

Because Astur is built on Playwright Test, you can run specs with the CLI **or** straight from the **VS Code Playwright extension** (the green ▶ run button) — fixtures, projects, `expect`, retries, and reporters all work.

## Documentation

Full docs: **https://astur-mobile.github.io/Astur/**

## License

Apache-2.0 © Amr Salem. "Astur" is a trademark — see the [main repository](https://github.com/Astur-mobile/Astur).
