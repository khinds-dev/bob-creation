/**
 * Vitest setup — provide minimum required environment variables
 * so config.ts can load without a .env file during testing.
 */
process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long-xx';
process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-32-characters-long-xx';
process.env['NODE_ENV'] = 'test';
