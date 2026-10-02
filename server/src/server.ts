import 'dotenv/config';
import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { drainWebhookJobs } from './controllers/whatsapp.controller.js';
const port = Number(process.env.PORT ?? 4000);
connectDatabase()
  .then(() => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
      throw new Error('JWT_SECRET must contain at least 32 characters');
    app.listen(port, () => console.log(`Lead CRM API listening on :${port}`));
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await drainWebhookJobs();
      } catch (error) {
        console.error('WhatsApp worker failed', error);
      } finally {
        running = false;
      }
    }, 15000).unref();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
