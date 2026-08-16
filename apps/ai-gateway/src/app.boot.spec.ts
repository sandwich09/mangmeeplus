import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

describe('AI Gateway application graph', () => {
  it('boots under the tsx local-dev loader without relying on emitted constructor metadata', async () => {
    const previous = {
      APP_ENV: process.env['APP_ENV'],
      DEPLOY_ENVIRONMENT: process.env['DEPLOY_ENVIRONMENT'],
      NODE_ENV: process.env['NODE_ENV'],
      SERVICE_NAME: process.env['SERVICE_NAME'],
    };
    Object.assign(process.env, {
      APP_ENV: 'local', DEPLOY_ENVIRONMENT: 'local', NODE_ENV: 'test', SERVICE_NAME: 'ai-gateway',
    });
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    try {
      assert.ok(app.get(AppModule));
    } finally {
      await app.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
