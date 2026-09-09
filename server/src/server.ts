import 'dotenv/config';
import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { runAutomationSweep } from './services/automation.service.js';

const port = Number(process.env.PORT ?? 4000);
// The automation engine's two time-based rules (uncontacted-lead escalation, stale-stage
// notification) run on this interval - a plain setInterval rather than a job queue, since each
// sweep is idempotent and cheap enough to just re-scan on a timer. Set to 0 to disable.
const AUTOMATION_INTERVAL_MINUTES = Number(process.env.AUTOMATION_INTERVAL_MINUTES ?? 5);

connectDatabase()
  .then(() => {
    app.listen(port, () => console.log(`Lead CRM API listening on :${port}`));
    if (AUTOMATION_INTERVAL_MINUTES > 0) {
      const intervalMs = AUTOMATION_INTERVAL_MINUTES * 60 * 1000;
      runAutomationSweep().catch(error => console.error('Automation sweep failed', error));
      setInterval(() => runAutomationSweep().catch(error => console.error('Automation sweep failed', error)), intervalMs);
    }
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
