import { AgentType } from '@skynet-ai/protocol';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { GeminiCliAdapter } from './adapters/gemini-cli.js';
import { CodexCliAdapter } from './adapters/codex-cli.js';
import { OpenCodeAdapter } from './adapters/opencode.js';
import type { AgentAdapter } from './base-adapter.js';

export interface DetectedAgent {
  type: AgentType;
  name: string;
  available: boolean;
}

const KNOWN_AGENTS = [AgentType.CLAUDE_CODE, AgentType.GEMINI_CLI, AgentType.CODEX_CLI, AgentType.OPENCODE] as const;

export async function detectAvailableAgents(projectRoot: string): Promise<DetectedAgent[]> {
  const adapters = createAllAdapters(projectRoot);
  const results: DetectedAgent[] = [];

  await Promise.all(
    adapters.map(async (adapter) => {
      const available = await adapter.isAvailable();
      results.push({ type: adapter.type, name: adapter.name, available });
    }),
  );

  return results.sort((a, b) => (a.available === b.available ? 0 : a.available ? -1 : 1));
}

export function createAdapter(type: AgentType, projectRoot: string): AgentAdapter {
  switch (type) {
    case AgentType.CLAUDE_CODE:
      return new ClaudeCodeAdapter({ projectRoot });
    case AgentType.GEMINI_CLI:
      return new GeminiCliAdapter({ projectRoot });
    case AgentType.CODEX_CLI:
      return new CodexCliAdapter({ projectRoot });
    case AgentType.OPENCODE:
      return new OpenCodeAdapter({ projectRoot });
    default:
      throw new Error(`No built-in adapter for type: ${type}. Use GenericAdapter instead.`);
  }
}

function createAllAdapters(projectRoot: string): AgentAdapter[] {
  return KNOWN_AGENTS.map((type) => createAdapter(type, projectRoot));
}
