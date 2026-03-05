import { randomUUID } from 'node:crypto';
import blessed from 'blessed';
import {
  AgentType,
  type AgentCard,
  type SkynetMessage,
  type AgentJoinPayload,
  type AgentLeavePayload,
  MessageType,
} from '@skynet/protocol';
import { SkynetClient, type RoomState } from '@skynet/sdk';
import {
  agentNameColored,
  agentTag,
  dimText,
  escapeMarkup,
  formatMessage,
  formatSystemMessage,
  createAgentResolver,
  type AgentResolver,
} from './format.js';

export interface ChatTUIOptions {
  roomId: string;
  serverUrl: string;
  name: string;
}

export async function runChatTUI(opts: ChatTUIOptions): Promise<void> {
  const { roomId, serverUrl, name } = opts;
  const members = new Map<string, AgentCard>();
  const resolve: AgentResolver = createAgentResolver(members);

  // ── Blessed screen ──
  const screen = blessed.screen({
    smartCSR: true,
    title: `skynet - ${roomId}`,
    fullUnicode: true,
  });

  // ── Header ──
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { bg: '#1a1a2e', fg: '#e0e0e0' },
    content: ` {bold}skynet{/bold} ${dimText('|')} connecting...`,
  });

  // ── Sidebar ──
  const sidebarWidth = 26;

  const sidebar = blessed.box({
    parent: screen,
    top: 1,
    right: 0,
    width: sidebarWidth,
    bottom: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: '#333333' }, bg: '#0d0d1a' },
    label: ` {bold}Members{/bold} `,
    scrollable: true,
    alwaysScroll: true,
  });

  // ── Messages ──
  const messageBox = blessed.log({
    parent: screen,
    top: 1,
    left: 0,
    right: sidebarWidth,
    bottom: 3,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: '#333333' } },
    mouse: true,
    style: { bg: '#0a0a1a' },
    padding: { left: 1, right: 1 },
  });

  // ── Input ──
  const inputBorder = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    style: { border: { fg: '#444444' }, bg: '#0d0d1a' },
    tags: true,
    label: ` {#888888-fg}Enter message (/help){/#888888-fg} `,
  });

  const input = blessed.textbox({
    parent: inputBorder,
    top: 0,
    left: 1,
    right: 1,
    height: 1,
    inputOnFocus: true,
    style: { fg: '#e0e0e0', bg: '#0d0d1a' },
  });

  // ── UI helpers ──
  function updateSidebar(): void {
    const lines: string[] = [];
    const sorted = Array.from(members.values()).sort((a, b) => {
      if (a.type === AgentType.HUMAN && b.type !== AgentType.HUMAN) return -1;
      if (a.type !== AgentType.HUMAN && b.type === AgentType.HUMAN) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const m of sorted) {
      const icon = m.status === 'busy' ? '{yellow-fg}*{/yellow-fg}' : '{green-fg}*{/green-fg}';
      lines.push(` ${icon} ${agentNameColored(m.name, m.type)}`);
      lines.push(`   ${agentTag(m.type)}`);
    }
    sidebar.setContent(lines.join('\n'));
    sidebar.setLabel(` {bold}Members{/bold} (${members.size}) `);
    screen.render();
  }

  function updateHeader(connected: boolean): void {
    const status = connected
      ? '{green-fg}connected{/green-fg}'
      : '{red-fg}disconnected{/red-fg}';
    header.setContent(
      ` {bold}skynet{/bold} ${dimText('|')} ${escapeMarkup(roomId)} ${dimText('|')} ${status} ${dimText('|')} ${members.size} members`
    );
    screen.render();
  }

  function log(line: string): void {
    messageBox.log(line);
    screen.render();
  }

  function sys(text: string): void {
    log(formatSystemMessage(text));
  }

  function showMessage(msg: SkynetMessage): void {
    for (const line of formatMessage(msg, resolve)) {
      log(line);
    }
  }

  // ── Commands ──
  function handleCommand(text: string): boolean {
    const cmd = text.toLowerCase().trim();
    if (cmd === '/quit' || cmd === '/exit' || cmd === '/q') return true;
    if (cmd === '/help' || cmd === '/h') {
      sys('Commands:');
      sys('  /help, /h       Show this help');
      sys('  /members, /m    List room members');
      sys('  /clear, /c      Clear messages');
      sys('  /quit, /q       Leave and exit');
      sys('  @name message   Direct message');
      return false;
    }
    if (cmd === '/members' || cmd === '/m') {
      sys('Room members:');
      for (const m of members.values()) {
        sys(`  ${agentNameColored(m.name, m.type)} ${agentTag(m.type)} [${m.status}]`);
      }
      return false;
    }
    if (cmd === '/clear' || cmd === '/c') {
      messageBox.setContent('');
      screen.render();
      return false;
    }
    sys(`Unknown command: ${escapeMarkup(cmd)}. Type /help for commands.`);
    return false;
  }

  // ── Connect ──
  const agentId = randomUUID();
  const client = new SkynetClient({
    serverUrl,
    agent: {
      agentId,
      name,
      type: AgentType.HUMAN,
      capabilities: ['chat', 'review'],
      status: 'idle',
    },
    roomId,
  });

  let state: RoomState;
  try {
    state = await client.connect();
  } catch (err) {
    screen.destroy();
    console.error('Failed to connect:', (err as Error).message);
    process.exit(1);
  }

  for (const m of state.members) {
    members.set(m.agentId, m);
  }
  updateSidebar();
  updateHeader(true);

  sys(`Welcome to {bold}${escapeMarkup(roomId)}{/bold}`);
  sys(`You are {bold}${escapeMarkup(name)}{/bold}. Type /help for commands.`);
  log('');

  if (state.recentMessages.length > 0) {
    sys(`--- recent messages (${state.recentMessages.length}) ---`);
    for (const msg of state.recentMessages) {
      showMessage(msg);
    }
    sys('--- end of history ---');
    log('');
  }

  // ── Wire SDK events ──
  client.on('message', (msg: SkynetMessage) => {
    if (msg.type === MessageType.AGENT_JOIN) {
      const p = msg.payload as AgentJoinPayload;
      members.set(p.agent.agentId, p.agent);
      updateSidebar();
      updateHeader(true);
    } else if (msg.type === MessageType.AGENT_LEAVE) {
      const p = msg.payload as AgentLeavePayload;
      members.delete(p.agentId);
      updateSidebar();
      updateHeader(true);
    }
    showMessage(msg);
  });

  client.on('disconnected', () => {
    updateHeader(false);
    sys('{red-fg}Disconnected from server{/red-fg}');
  });

  client.on('reconnecting', () => {
    sys('{yellow-fg}Reconnecting...{/yellow-fg}');
  });

  client.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    sys(`{red-fg}Error: ${escapeMarkup(msg)}{/red-fg}`);
  });

  // ── Input loop ──
  function promptInput(): void {
    input.focus();
    input.readInput(() => {
      const text = (input.getValue() ?? '').trim();
      input.clearValue();
      screen.render();

      if (text) {
        if (text.startsWith('/')) {
          if (handleCommand(text)) {
            cleanup();
            return;
          }
        } else {
          const dmMatch = text.match(/^@(\S+)\s+(.*)/s);
          if (dmMatch) {
            const targetName = dmMatch[1];
            let targetId: string | null = null;
            for (const [id, card] of members) {
              if (card.name.toLowerCase() === targetName.toLowerCase()) {
                targetId = id;
                break;
              }
            }
            if (targetId) {
              client.chat(dmMatch[2], targetId);
            } else {
              sys(`No member found: "${escapeMarkup(targetName)}"`);
            }
          } else {
            client.chat(text);
          }
        }
      }

      promptInput();
    });
  }

  async function cleanup(): Promise<void> {
    sys('Leaving room...');
    await client.close();
    screen.destroy();
    process.exit(0);
  }

  // ── Key bindings ──
  screen.key(['C-c'], () => { cleanup(); });
  screen.key(['escape'], () => { promptInput(); });
  screen.key(['pageup'], () => {
    messageBox.scroll(-(messageBox.height as number));
    screen.render();
  });
  screen.key(['pagedown'], () => {
    messageBox.scroll(messageBox.height as number);
    screen.render();
  });

  screen.render();
  promptInput();
}
