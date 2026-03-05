#!/usr/bin/env node

import { Command } from 'commander';
import { registerServerCommand } from './commands/server.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerChatCommand } from './commands/chat.js';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('skynet')
  .description('Multi-Agent Collaboration Network')
  .version('0.1.0');

registerServerCommand(program);
registerAgentCommand(program);
registerChatCommand(program);
registerStatusCommand(program);

program.parse();
