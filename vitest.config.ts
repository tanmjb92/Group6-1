import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      include: [
        'lib/auth.ts',
        'lib/auth/**/*.ts',
        'lib/db.ts',
        'lib/tag-input.ts',
        'lib/todo-input.ts',
        'lib/reminder-options.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
