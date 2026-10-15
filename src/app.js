import express from 'express';

// Builds the Express app without listening, so tests can drive it directly.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  return app;
}
