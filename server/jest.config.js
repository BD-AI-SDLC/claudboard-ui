export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@bosch-sdlc/protocol$': '<rootDir>/../protocol/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/dist'],
  globals: {
    'ts-jest': {
      useESM: true,
      isolatedModules: true,
    },
  },
}
