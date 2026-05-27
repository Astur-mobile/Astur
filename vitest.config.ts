import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@astur/android': root('./packages/android/src/index.ts'),
      '@astur/cli': root('./packages/cli/src/index.ts'),
      '@astur/core': root('./packages/core/src/index.ts'),
      '@astur/ios': root('./packages/ios/src/index.ts'),
      '@astur/protocol': root('./packages/protocol/src/index.ts'),
      '@astur/test': root('./packages/test/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false
  }
});
