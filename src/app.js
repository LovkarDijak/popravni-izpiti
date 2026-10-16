import express from 'express';
import { fileURLToPath } from 'node:url';
import { openDb } from './db/index.js';
import { html, page } from './html.js';
import { prijavaRouter } from './routes/prijava.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

// Builds the Express app without listening, so tests can drive it directly.
// store: the database from openDb (a throwaway in-memory one when left out); now: the clock.
export function createApp({ store = openDb(':memory:'), now = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // The pages use no inline script or style, so a strict policy costs nothing.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (req, res) => res.redirect('/prijava'));
  app.use('/prijava', prijavaRouter(store, { now }));
  app.use(express.static(publicDir));

  // Anything unexpected: log it on the server, show the visitor nothing internal.
  const errorPage = (res, status, message) => res.status(status).type('html').send(page({
    title: 'Napaka',
    body: html`<h1>Napaka</h1>\n<p>${message}</p>\n<p><a href="/prijava">Nazaj na prijavo</a></p>`,
  }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    // A request the server could not read (too large, too many fields, unknown charset): the client's fault.
    // Never log it: such errors carry the raw form, with students' names and e-mails, in err.body.
    if (err.status >= 400 && err.status < 500) {
      return errorPage(res, err.status, err.status === 413
        ? 'Poslani podatki so preobsežni.'
        : 'Poslanih podatkov ni bilo mogoče prebrati.');
    }
    console.error(err.stack ?? String(err));
    return errorPage(res, 500, 'Prišlo je do napake na strežniku. Poskusi znova pozneje.');
  });

  return app;
}
