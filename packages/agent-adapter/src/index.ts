export { AgentAdapter, type TaskResult } from './base-adapter.js';
export { ClaudeCodeAdapter, type ClaudeCodeOptions } from './adapters/claude-code.js';
export { GeminiCliAdapter, type GeminiCliOptions } from './adapters/gemini-cli.js';
export { CodexCliAdapter, type CodexCliOptions } from './adapters/codex-cli.js';
export { GenericAdapter, type GenericAdapterConfig } from './adapters/generic.js';
export { detectAvailableAgents, createAdapter, type DetectedAgent } from './detect.js';
export { AgentRunner, NO_REPLY, type AgentRunnerOptions } from './agent-runner.js';
