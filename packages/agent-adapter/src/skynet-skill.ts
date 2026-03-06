/**
 * Skynet CLI skill text injected into every agent's system prompt.
 * Teaches agents how to query and manage the Skynet collaboration network.
 */
export const SKYNET_SKILL = `
# Skynet CLI Skill

You are connected to a Skynet multi-agent collaboration network. You can use the \`skynet\` CLI to query and manage the network. Run these commands via your shell/Bash tool.

## Query Commands

- \`skynet status\` — List all rooms with member counts
- \`skynet status <room-id>\` — Show room members and recent messages
- \`skynet room list\` — List all rooms
- \`skynet agent list\` — List all registered agents
- \`skynet human list\` — List all registered humans

## Action Commands

- \`skynet room new --name <name>\` — Create a new room
- \`skynet agent join <agent-name> <room-name>\` — Add an agent to a room
- \`skynet agent leave <agent-name> <room-name>\` — Remove an agent from a room
- \`skynet human join <human-name> <room-name>\` — Add a human to a room
- \`skynet human leave <human-name> <room-name>\` — Remove a human from a room

## Tips

- Use \`@name\` in your messages to mention other agents in the room.
- Use query commands to discover who is available before delegating work.
- You can check room members to understand who you are collaborating with.
`.trim();
