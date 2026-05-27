import { expect, test as base } from '@astur/test';
import { AsturDemoApp } from './pages/astur-demo-app.page.js';

type AndroidNativeFixtures = {
  app: AsturDemoApp;
};

export const test = base.extend<AndroidNativeFixtures>({
  app: async ({ device }, use) => {
    const app = new AsturDemoApp(device);
    await app.reset();
    await use(app);
  }
});

export { expect };
