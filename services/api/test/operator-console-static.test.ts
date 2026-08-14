import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('operator console static delivery', () =>
  it('serves the built operator-console bundle from the API origin when configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'apps-operator-console-dist-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>operator console</title>');
    const app = buildServer({ operatorConsoleDistDir: directory });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('operator console');
    await app.close();
  }));

describe('operator console application identity', () =>
  it('is packaged independently from the provider console', async () => {
    const packageUrl = new URL('../../../apps/operator-console/package.json', import.meta.url);
    const manifest = JSON.parse(await readFile(packageUrl, 'utf8')) as { name?: unknown };

    expect(manifest.name).toBe('operator-console');
  }));
