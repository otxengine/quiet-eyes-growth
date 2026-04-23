/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset:      'ts-jest',
  testEnvironment: 'node',
  roots:       ['<rootDir>/src/__tests__'],
  testMatch:   ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false } }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  clearMocks: true,
};
