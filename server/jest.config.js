module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/setup.ts'],
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@octokit/rest$': '<rootDir>/__mocks__/@octokit/rest.ts',
    '^@octokit/plugin-throttling$': '<rootDir>/__mocks__/@octokit/plugin-throttling.ts',
  },
  clearMocks: true,
};
