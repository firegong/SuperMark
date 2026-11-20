/** @type { import('ts-jest').JestConfigWithTsJest } */

// eslint-disable-next-line no-undef
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/test/utils/setup.ts'],
  moduleNameMapper: {
    '^@codemirror/lang-html$': '<rootDir>/src/@vendor/lang-html',
    '^@codemirror/lang-markdown$': '<rootDir>/src/@vendor/lang-markdown',
    '^(\\./(?:script\\.js|style\\.css))\\?raw$': '$1',
  },
  transform: {
    '^.+[\\\\/]src[\\\\/]modules[\\\\/]preview[\\\\/]frame[\\\\/](?:script\\.js|style\\.css)$': '<rootDir>/test/utils/rawTextTransformer.cjs',
    '^.+\\.tsx?$': ['ts-jest', {}],
    // ESM-only packages (micromark / mdast for the micromark parser) are compiled to CommonJS.
    '^.+[\\\\/]node_modules[\\\\/].+\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  // Transform these ESM-only packages; everything else in node_modules is used as is.
  transformIgnorePatterns: [
    '[\\\\/]node_modules[\\\\/](?!(micromark|mdast-util|unist-util|ccount|character-entities|decode-named-character-reference|devlop|longest-streak|markdown-table|zwitch|escape-string-regexp)[^\\\\/]*[\\\\/])',
  ],
};
