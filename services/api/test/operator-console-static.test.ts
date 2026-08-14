import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

describe('operator console static delivery', () =>
  it('serves the built operator-console bundle from the API origin when configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'apps-operator-console-dist-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>operator console</title>');
    const app = buildServer({ operatorConsoleDistDir: directory });

    const response = await app.inject({ method: 'GET', url: '/operator/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('operator console');
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    await app.close();
  }));

describe('separate control-plane static delivery', () =>
  it('keeps provider and operator bundles on their own URL prefixes', async () => {
    const providerDirectory = await mkdtemp(join(tmpdir(), 'apps-provider-console-dist-'));
    const operatorDirectory = await mkdtemp(join(tmpdir(), 'apps-operator-console-dist-'));
    await mkdir(join(providerDirectory, 'assets'));
    await mkdir(join(operatorDirectory, 'assets'));
    await writeFile(join(providerDirectory, 'index.html'), '<!doctype html><title>provider console</title>');
    await writeFile(join(operatorDirectory, 'index.html'), '<!doctype html><title>operator console</title>');
    await writeFile(join(providerDirectory, 'assets', 'provider.js'), 'provider bundle');
    await writeFile(join(operatorDirectory, 'assets', 'operator.js'), 'operator bundle');

    const app = buildServer({
      providerConsoleDistDir: providerDirectory,
      operatorConsoleDistDir: operatorDirectory
    } as Parameters<typeof buildServer>[0]);

    expect((await app.inject({ method: 'GET', url: '/provider/' })).body).toContain('provider console');
    expect((await app.inject({ method: 'GET', url: '/operator/' })).body).toContain('operator console');
    expect((await app.inject({ method: 'GET', url: '/provider/assets/operator.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/operator/assets/provider.js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    await app.close();
  }));

describe('operator console application identity', () =>
  it('is packaged independently from the provider console', async () => {
    const packageUrl = new URL('../../../apps/operator-console/package.json', import.meta.url);
    const manifest = JSON.parse(await readFile(packageUrl, 'utf8')) as { name?: unknown };

    expect(manifest.name).toBe('operator-console');
  }));
