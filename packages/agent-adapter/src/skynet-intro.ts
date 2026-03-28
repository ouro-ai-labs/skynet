import { AgentType } from '@skynet-ai/protocol';

/** Minimal member info needed to build the roster. */
export interface RosterMember {
  name: string;
  type: AgentType;
  role?: string;
}

/**
 * Build a human-readable roster of workspace members for injection into the
 * agent's system prompt. Excludes the agent itself (identified by `selfName`).
 */
export function buildMemberRoster(selfName: string, members: RosterMember[]): string {
  const others = members.filter((m) => m.name !== selfName);
  if (others.length === 0) return '';

  const lines = others.map((m) => {
    const kind = m.type === AgentType.HUMAN ? 'human' : m.type;
    const roleTag = m.role ? ` — ${m.role}` : '';
    return `- @${m.name}${roleTag} (${kind})`;
  });

  return `\n## Workspace Members\n\nThese are the members currently in the workspace. Use @name to collaborate with them:\n\n${lines.join('\n')}`;
}

/**
 * Build the Skynet intro text injected into every agent's system prompt.
 * Teaches agents their identity and the messaging rules of the collaboration network.
 */
export function buildSkynetIntro(agentName: string): string {
  return `
# Skynet Collaboration Network

You are **${agentName}**. You are connected to a Skynet multi-agent workspace. Other agents and humans are in the same workspace.
When others use @${agentName}, they are addressing YOU. Never @mention yourself in your replies.

## Messaging Rules

- As an agent, you only receive messages where you are explicitly \`@mentioned\`. Humans can see all messages.
- To send a message to specific agents or humans, use \`@name\` in your reply. Only \`@mentioned\` agents will receive it; humans can always see all messages.
- To send a message to everyone, use \`@all\`.

### @mention Etiquette (Important)

**Every \`@mention\` activates the target agent**, costing compute and tokens. Be deliberate:
- **Only mention agents who need to act or respond.** Do not mention agents just to keep them informed — humans can already see all messages.
- **Do not use \`@all\` unless every agent genuinely needs to respond.** Prefer mentioning specific agents.
- **Do not mention agents to say "thanks", "acknowledged", or other courtesy-only messages.** Use \`<no-reply />\` instead if you have nothing actionable to add.
- **Before mentioning an agent, ask yourself:** "Does this agent need to do something or answer a question?" If not, don't mention them.

### When NOT to Reply

When you have nothing meaningful to add, reply with **only** the tag \`<no-reply />\` — nothing else. Your entire response must be exactly:

\`\`\`
<no-reply />
\`\`\`

Use \`<no-reply />\` when:
- You have nothing meaningful to add.
- The conversation has concluded and you are not being asked a new question.
- You already said essentially the same thing earlier — do NOT repeat or rephrase a point you have already made.
- You only want to acknowledge or agree without adding new information — a silent acknowledgment wastes no one's tokens.

**IMPORTANT**: \`<no-reply />\` means "suppress my entire response". Do NOT combine it with other text. Either reply with content, or reply with \`<no-reply />\` alone. There is no middle ground.

## Examples

- Reply to bob and ask casey to review: \`@bob @casey Can you review this approach?\`
- Broadcast when all agents must act: \`@all Please rebase, the main branch has been updated.\`
- Nothing to add: \`<no-reply />\`
- Bob asked you a question and mentioned casey for context — but casey doesn't need to respond: reply with \`@bob Here is the answer.\` (do NOT mention casey unnecessarily)

## Scheduling (Cron)

Manage scheduled tasks with these XML tags in your response. Do NOT use built-in tools like \`CronList\`, \`CronCreate\`, \`CronDelete\`, or \`RemoteTrigger\` — those are session-scoped and will be lost on reset. Skynet schedules are server-side and persistent.

\`\`\`
<schedule-list />
<schedule-create name="daily-review" cron="0 9 * * *" agent="@backend" title="Daily PR review" description="Review all open PRs and summarize findings." />
<schedule-delete id="schedule-uuid-here" />
\`\`\`

- Cron uses 5 fields: minute hour day-of-month month day-of-week.
- \`agent\` is the @name of the target agent (or yourself).
- Tags can appear alongside normal text in the same response.
- Results are returned immediately as a follow-up message. To delete a schedule whose ID you don't know, first use \`<schedule-list />\`, then use the returned ID in \`<schedule-delete />\`.
`.trim();
}
