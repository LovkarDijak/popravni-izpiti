import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { openDb } from './db/index.js';

// Optional local settings; variables already set in the environment win.
try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const rawPort = process.env.PORT || '3000';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Neveljaven PORT: "${rawPort}" (pričakujem celo število od 0 do 65535).`);
  process.exit(1);
}

const dbPath = process.env.DB_PATH || 'data/popravni-izpiti.sqlite';
let store;
try {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  store = openDb(dbPath);
} catch (err) {
  console.error(`Baze ni bilo mogoče odpreti (${dbPath}): ${err.message}`);
  process.exit(1);
}

const server = createApp({ store }).listen(port, () => {
  console.log(`Strežnik teče na http://localhost:${server.address().port}`);
});

server.on('error', (err) => {
  console.error(`Strežnika ni bilo mogoče zagnati: ${err.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
