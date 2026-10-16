import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';
import { SEED } from '../src/db/seed.js';

const seedPath = fileURLToPath(new URL('../src/db/seed.js', import.meta.url));

function runSeed(dbPath) {
  return spawnSync(process.execPath, [seedPath], {
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

test('npm run seed napolni bazo enkrat in drugič nič ne spremeni', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'popravni-seed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'nova', 'baza.sqlite');

  const first = runSeed(dbPath);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Izmišljeni podatki so v/);

  const second = runSeed(dbPath);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /že vsebuje podatke/);

  const store = openDb(dbPath);
  t.after(() => store.close());
  assert.equal(store.listRegistrations().length, SEED.registrations.length);
});

test('seme zavrne DB_PATH :memory:', () => {
  const result = runSeed(':memory:');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ne :memory:/);
});
