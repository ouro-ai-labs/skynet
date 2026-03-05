import { Command } from 'commander';
import { SkynetServer } from '@skynet/server';

export function registerServerCommand(program: Command): void {
  const server = program.command('server').description('Manage the Skynet server');

  server
    .command('start')
    .description('Start the Skynet server')
    .option('-p, --port <port>', 'Port to listen on', '4117')
    .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
    .option('--db <path>', 'SQLite database path (default: in-memory)')
    .action(async (opts) => {
      const srv = new SkynetServer({
        port: parseInt(opts.port, 10),
        host: opts.host,
        dbPath: opts.db,
      });

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await srv.stop();
        process.exit(0);
      });

      await srv.start();
      console.log(`Skynet server running on ${opts.host}:${opts.port}`);
    });
}
