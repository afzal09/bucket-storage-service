module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/tests/**/*.spec.ts', '<rootDir>/packages/*/tests/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'commonjs',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
};
