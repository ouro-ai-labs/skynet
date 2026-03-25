#!/usr/bin/env node

import { Command } from 'commander';
import { registerWorkspaceCommand } from './commands/workspace.js';
import { registerAgentCommand } from './commands/agent.js';
import { registerHumanCommand } from './commands/human.js';
import { registerChatCommand } from './commands/chat.js';
import { registerStatusCommand } from './commands/status.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerScheduleCommand } from './commands/schedule.js';

const program = new Command();

program
  .name('skynet')
  .description('Multi-Agent Collaboration Network')
  .version('0.1.0')
  .enablePositionalOptions();

registerWorkspaceCommand(program);
registerAgentCommand(program);
registerHumanCommand(program);
registerChatCommand(program);
registerStatusCommand(program);
registerScheduleCommand(program);
registerDoctorCommand(program);

program.parse();
