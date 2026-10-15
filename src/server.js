import { createApp } from './app.js';

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

const server = createApp().listen(port, () => {
  console.log(`Strežnik teče na http://localhost:${server.address().port}`);
});

server.on('error', (err) => {
  console.error(`Strežnika ni bilo mogoče zagnati: ${err.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
