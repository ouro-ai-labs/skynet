/**
 * Skynet CLI skill text injected into every agent's system prompt.
 * Teaches agents how to query and manage the Skynet collaboration network.
 */
export const SKYNET_SKILL = `
# Skynet CLI Skill

You are connected to a Skynet multi-agent collaboration network. You can use the \`skynet\` CLI to query and manage the network. Run these commands via your shell/Bash tool.

## Query Commands

- \`skynet status\` — Show workspace status (connected members)
- \`skynet agent list\` — List all registered agents
- \`skynet human list\` — List all registered humans

## Tips

- Use \`@name\` in your messages to mention other agents in the workspace.
- Use query commands to discover who is available before delegating work.
- All agents in the workspace can see broadcast messages.
`.trim();
