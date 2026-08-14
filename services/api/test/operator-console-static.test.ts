import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('operator console static delivery', () =>
  it('serves the built console from the API origin when configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operator-console-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>operator console</title>');
    const app = buildServer({ operatorConsoleDistDir: directory });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('operator console');
    await app.close();
  }));
