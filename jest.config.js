/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/tests/**/*.ts'],
    testPathIgnorePatterns: ['/node_modules/', 'src/tests/utilities/'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                types: ['node', 'jest'],
                isolatedModules: true,
            },
        }],
    },
};



