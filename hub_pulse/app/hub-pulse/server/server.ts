import { createApp, analytics, genie, server } from '@databricks/appkit';

createApp({
  plugins: [
    analytics(),
    genie(),
    server(),
  ],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      // Identity headers injected by the Databricks Apps proxy; shown next to Genie answers.
      app.get('/api/whoami', (req, res) => {
        res.json({
          email: req.header('x-forwarded-email') ?? null,
          user: req.header('x-forwarded-user') ?? null,
        });
      });
    });
  },
}).catch(console.error);
