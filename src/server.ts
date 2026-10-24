import { app } from './app';
import { env } from './config/env';

const server = app.listen(env.port, () => {
  console.log(`API running at http://localhost:${env.port}`);
});

server.on('error', (error) => {
  console.error('Unable to start API:', error.message);
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
