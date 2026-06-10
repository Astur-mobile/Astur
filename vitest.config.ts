import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@astur-mobile/android': root('./packages/android/src/index.ts'),
      '@astur-mobile/cli': root('./packages/cli/src/index.ts'),
      '@astur-mobile/core': root('./packages/core/src/index.ts'),
      '@astur-mobile/ios': root('./packages/ios/src/index.ts'),
      '@astur-mobile/protocol': root('./packages/protocol/src/index.ts'),
      '@astur-mobile/test': root('./packages/test/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false
  }
});
