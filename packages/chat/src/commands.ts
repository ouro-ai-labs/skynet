export interface CommandResult {
  lines: string[];
  error?: boolean;
}

export async function executeCommand(serverUrl: string, input: string, humanId?: string): Promise<CommandResult | null> {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0) return null;

  const category = parts[0];
  const subcommand = parts[1];
  const arg = parts[2];

  switch (category) {
    case '/help':
    case '/h':
      return handleHelpCommand();
    case '/agent':
      return handleAgentCommand(serverUrl, subcommand, arg);
    case '/human':
      return handleHumanCommand(serverUrl, subcommand);
    case '/watch':
      return handleWatchCommand(serverUrl, subcommand, humanId);
    case '/unwatch':
      return handleUnwatchCommand(serverUrl, subcommand, humanId);
    default:
      return null;
  }
}

function handleHelpCommand(): CommandResult {
  return {
    lines: [
      'Available commands:',
      '',
      '/help              Show this help',
      '/agent list        List all agents',
      '/agent interrupt @name  Interrupt an agent',
      '/agent interrupt @all   Interrupt all agents',
      '/agent forget @name     Reset agent session',
      '/human list        List all humans',
      '/watch @name       Subscribe to agent logs',
      '/unwatch @name     Unsubscribe from agent logs',
    ],
  };
}

async function handleAgentCommand(serverUrl: string, sub: string | undefined, arg?: string): Promise<CommandResult> {
  if (!sub || sub === 'list') {
    try {
      const res = await fetch(`${serverUrl}/api/agents`);
      const agents = await res.json() as Array<{ id: string; name: string; type: string; role?: string; status?: string }>;
      if (agents.length === 0) return { lines: ['No agents.'] };
      return {
        lines: [
          `Agents (${agents.length}):`,
          ...agents.map((a) => {
            const icon = a.status === 'busy' ? '\u{1F7E1}' : a.status === 'error' ? '\u{1F534}' : a.status === 'idle' ? '\u{1F7E2}' : '\u26AB';
            return `  ${icon} ${a.name} (${a.type})${a.role ? ` [${a.role}]` : ''} [${a.id.slice(0, 8)}]`;
          }),
        ],
      };
    } catch {
      return { lines: ['Failed to connect to workspace.'], error: true };
    }
  }

  if (sub === 'interrupt' || sub === 'forget') {
    if (!arg || !arg.startsWith('@')) {
      return { lines: [`Usage: /agent ${sub} @<name>`], error: true };
    }
    return sendAgentControl(serverUrl, sub, arg);
  }

  return { lines: ['Usage: /agent list | /agent interrupt @<name> | /agent forget @<name>'], error: true };
}

async function sendAgentControl(serverUrl: string, action: 'interrupt' | 'forget', nameOrId: string): Promise<CommandResult> {
  try {
    const resolved = nameOrId.slice(1); // strip leading '@'

    const listRes = await fetch(`${serverUrl}/api/agents`);
    const agents = await listRes.json() as Array<{ id: string; name: string }>;

    // Handle @all: apply action to every agent
    if (resolved === 'all') {
      if (agents.length === 0) return { lines: ['No agents.'] };
      const results: string[] = [];
      const label = action === 'interrupt' ? 'Interrupted' : 'Session cleared for';
      for (const agent of agents) {
        const res = await fetch(`${serverUrl}/api/agents/${agent.id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          results.push(`${label} agent '${agent.name}'.`);
        } else {
          const body = await res.json() as { error?: string };
          results.push(body.error ?? `Failed to ${action} agent '${agent.name}'.`);
        }
      }
      return { lines: results };
    }

    // Resolve agent name to ID
    const agent = agents.find((a) => a.name === resolved || a.id === resolved || a.id.startsWith(resolved));
    if (!agent) {
      return { lines: [`Agent '${nameOrId}' not found.`], error: true };
    }

    const res = await fetch(`${serverUrl}/api/agents/${agent.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (res.ok) {
      const label = action === 'interrupt' ? 'Interrupted' : 'Session cleared for';
      return { lines: [`${label} agent '${agent.name}'.`] };
    }
    const body = await res.json() as { error?: string };
    return { lines: [body.error ?? `Failed to ${action} agent.`], error: true };
  } catch {
    return { lines: ['Failed to connect to workspace.'], error: true };
  }
}

async function handleHumanCommand(serverUrl: string, sub: string | undefined): Promise<CommandResult> {
  if (!sub || sub === 'list') {
    try {
      const res = await fetch(`${serverUrl}/api/humans`);
      const humans = await res.json() as Array<{ id: string; name: string }>;
      if (humans.length === 0) return { lines: ['No humans.'] };
      return {
        lines: [
          `Humans (${humans.length}):`,
          ...humans.map((h) => `  ${h.name} [${h.id.slice(0, 8)}]`),
        ],
      };
    } catch {
      return { lines: ['Failed to connect to workspace.'], error: true };
    }
  }

  return { lines: ['Usage: /human list'], error: true };
}

async function handleWatchCommand(serverUrl: string, nameArg: string | undefined, humanId?: string): Promise<CommandResult> {
  if (!nameArg || !nameArg.startsWith('@')) {
    return { lines: ['Usage: /watch @<agent-name>'], error: true };
  }
  if (!humanId) {
    return { lines: ['Cannot determine your identity.'], error: true };
  }
  return sendWatchControl(serverUrl, 'watch', nameArg, humanId);
}

async function handleUnwatchCommand(serverUrl: string, nameArg: string | undefined, humanId?: string): Promise<CommandResult> {
  if (!nameArg || !nameArg.startsWith('@')) {
    return { lines: ['Usage: /unwatch @<agent-name>'], error: true };
  }
  if (!humanId) {
    return { lines: ['Cannot determine your identity.'], error: true };
  }
  return sendWatchControl(serverUrl, 'unwatch', nameArg, humanId);
}

async function sendWatchControl(serverUrl: string, action: 'watch' | 'unwatch', nameOrId: string, humanId: string): Promise<CommandResult> {
  try {
    const resolved = nameOrId.slice(1); // strip leading '@'

    const listRes = await fetch(`${serverUrl}/api/agents`);
    const agents = await listRes.json() as Array<{ id: string; name: string }>;

    // Resolve agent name to ID
    const agent = agents.find((a) => a.name === resolved || a.id === resolved || a.id.startsWith(resolved));
    if (!agent) {
      return { lines: [`Agent '${nameOrId}' not found.`], error: true };
    }

    const res = await fetch(`${serverUrl}/api/agents/${agent.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ humanId }),
    });

    if (res.ok) {
      const label = action === 'watch'
        ? `Watching agent '${agent.name}'. Execution logs will appear inline.`
        : `Stopped watching agent '${agent.name}'.`;
      return { lines: [label] };
    }
    const body = await res.json() as { error?: string };
    return { lines: [body.error ?? `Failed to ${action} agent.`], error: true };
  } catch {
    return { lines: ['Failed to connect to workspace.'], error: true };
  }
}
