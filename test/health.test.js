import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';

const serverPath = fileURLToPath(new URL('../src/server.js', import.meta.url));

function startServer(env) {
  return spawn(process.execPath, [serverPath], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Resolves with the port the server reports once it is listening.
function waitForPort(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) finish(null, Number(match[1]));
    };
    const onExit = (code) => finish(new Error(`Strežnik se je ustavil (koda ${code}):\n${output}`));
    const timer = setTimeout(
      () => finish(new Error(`Strežnik se ni zagnal v ${timeoutMs} ms:\n${output}`)),
      timeoutMs,
    );
    function finish(err, port) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      if (err) reject(err);
      else resolve(port);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', onExit);
  });
}

test('GET /health vrne 200 in {"ok": true}', async () => {
  const res = await request(createApp()).get('/health');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.deepEqual(res.body, { ok: true });
});

test('odgovor ne izda ogrodja (brez glave X-Powered-By)', async () => {
  const res = await request(createApp()).get('/health');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('neznana pot vrne 404', async () => {
  const res = await request(createApp()).get('/ne-obstaja');
  assert.equal(res.status, 404);
});

test('strežnik se zažene na vratih iz PORT in odgovori na /health', async (t) => {
  const child = startServer({ PORT: '0' });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });

  const port = await waitForPort(child);
  assert.ok(port > 0);

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

for (const badPort of ['abc', '70000', '-1']) {
  test(`neveljaven PORT "${badPort}" ustavi zagon z jasnim sporočilom`, async () => {
    const child = startServer({ PORT: badPort });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.match(stderr, /Neveljaven PORT/);
  });
}
