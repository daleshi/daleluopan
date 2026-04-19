'use strict';

/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    globalSetup: '<rootDir>/tests/setup/globalSetup.js',
    globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
    maxWorkers: 1,
    testTimeout: 30000,
    verbose: true,
};
