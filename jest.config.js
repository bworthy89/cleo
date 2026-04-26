module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv',
    '^\\.\\./\\.\\./modules/expo-music-kit$': '<rootDir>/__mocks__/expo-music-kit',
    '^\\.\\./\\.\\./\\.\\./modules/expo-music-kit$': '<rootDir>/__mocks__/expo-music-kit',
    '^@sentry/react-native$': '<rootDir>/__mocks__/@sentry/react-native',
    '^@react-native-community/netinfo$': '<rootDir>/__mocks__/@react-native-community/netinfo',
    '^@react-native-firebase/firestore$': '<rootDir>/__mocks__/@react-native-firebase/firestore',
    '^@react-native-firebase/auth$': '<rootDir>/__mocks__/@react-native-firebase/auth',
    '^react-native$': '<rootDir>/__mocks__/react-native',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo-.*|@expo/.*|react-native.*|@react-native.*)/)',
  ],
};
