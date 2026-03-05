#!/usr/bin/env node

import { Command } from 'commander';
import { registerServerCommand } from './commands/server.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerChatCommand } from './commands/chat.js';
import { registerStatusCommand } from './commands/status.js';
import { registerRoomCommand } from './commands/room.js';
import { initConfig, getConfigPath } from './config.js';

const program = new Command();

program
  .name('skynet')
  .description('Multi-Agent Collaboration Network')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize ~/.skynet/ directory and default config')
  .action(() => {
    initConfig();
    console.log(`Config initialized at ${getConfigPath()}`);
  });

registerServerCommand(program);
registerAgentCommand(program);
registerChatCommand(program);
registerStatusCommand(program);
registerRoomCommand(program);

program.parse();
