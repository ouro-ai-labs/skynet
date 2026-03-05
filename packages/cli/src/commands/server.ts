import { Command } from 'commander';
import { SkynetServer, SqliteStore } from '@skynet/server';
import { loadConfig, ensureSkynetDir } from '../config.js';

export function registerServerCommand(program: Command): void {
  const server = program.command('server').description('Manage the Skynet server');

  server
    .command('start')
    .description('Start the Skynet server')
    .option('-p, --port <port>', 'Port to listen on')
    .option('-h, --host <host>', 'Host to bind to')
    .option('--db <path>', 'SQLite database path')
    .action(async (opts) => {
      const config = loadConfig();
      ensureSkynetDir();

      const port = opts.port ? parseInt(opts.port, 10) : config.server.port;
      const host = opts.host ?? config.server.host;
      const dbPath = opts.db ?? config.server.dbPath;

      const store = new SqliteStore(dbPath);
      const srv = new SkynetServer({ port, host, store });

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await srv.stop();
        process.exit(0);
      });

      await srv.start();
      console.log(`Skynet server running on ${host}:${port}`);
      console.log(`Database: ${dbPath}`);
    });
}
