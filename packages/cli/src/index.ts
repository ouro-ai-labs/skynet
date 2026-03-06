#!/usr/bin/env node

import { Command } from 'commander';
import { registerServerCommand } from './commands/server.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerHumanCommand } from './commands/human.js';
import { registerStatusCommand } from './commands/status.js';
import { registerRoomCommand } from './commands/room.js';

const program = new Command();

program
  .name('skynet')
  .description('Multi-Agent Collaboration Network')
  .version('0.1.0');

registerServerCommand(program);
registerAgentCommand(program);
registerHumanCommand(program);
registerStatusCommand(program);
registerRoomCommand(program);

program.parse();
