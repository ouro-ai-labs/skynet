# Skill Marketplace — Multi-Agent Demo

Build a skill marketplace website with 3 AI agents (PM, backend, frontend) collaborating autonomously while you supervise via chat.

## Prerequisites

- Node.js 20+
- A coding agent with the [Skynet skill](../../skills/skynet/SKILL.md) loaded (e.g., Claude Code)

## Step 1: Set Up the Workspace

Give this prompt to your coding agent:

```
Use skynet to set up a workspace called "skill-market" for building a skill marketplace website.

All agents share the same project directory: /tmp/skynet-demo/ (create it if it doesn't exist). Use --workdir /tmp/skynet-demo for every agent.

Create these members:
1. Agent "pm" (claude-code) — role: "project manager", persona: "You are a senior PM. Break down tasks, assign them to the right team members via @mentions, track progress, and resolve blockers. Always communicate in clear, actionable terms."
2. Agent "backend" (claude-code) — role: "backend engineer", persona: "You are a backend engineer. Build REST APIs, design database schemas, and implement server-side logic. Coordinate with @frontend on API contracts."
3. Agent "frontend" (claude-code) — role: "frontend engineer", persona: "You are a frontend engineer. Build React UI components, pages, and handle styling. Coordinate with @backend on API contracts."
4. Human "me"

Start the workspace and all agents as daemons, then show me the status.
```

Once status shows all agents online, open a separate terminal:

```bash
npx @skynet-ai/cli@latest chat --name me --workspace skill-market
```

## Step 2: Kick Off the Project

Paste this in the chat to start:

```
@pm We're building a skill marketplace website where users can browse, publish, and install skills for AI agents. The MVP needs: (1) a browse page with search and category filters, (2) a skill detail page, and (3) a publish page. Please break this into tasks for @backend and @frontend — define the API contract between them, then kick things off. Start with backend API + seed data so frontend can develop against real endpoints.
```

The PM will create a task breakdown and assign work to `@backend` and `@frontend`. They will start coding autonomously.

## Step 3: Supervise and Steer

You don't need to micromanage. Jump in at key moments:

| When | What to say |
|------|-------------|
| Check progress | `@pm What's the current status? Any blockers?` |
| Give design feedback | `@frontend Use a card grid layout, each card shows: skill name, author, install count, one-line description. Keep it minimal.` |
| Push integration | `@pm Backend API should be ready by now. Tell @frontend to switch from mock data to real endpoints.` |
| Scope down | `@backend Skip auth for MVP. Just add a simple author name field when publishing.` |
| Course correct | `@pm The detail page is lower priority. Focus on browse + publish first.` |
| Wrap up | `@pm Let's wrap up. Make sure everything builds and runs, then give me a summary of what was delivered.` |

## Step 4: Clean Up

Give this prompt to your coding agent:

```
Use skynet to stop all agents and the workspace "skill-market".
```

## Tips

- **@mention = activation**: Every `@name` costs compute. Only mention agents who need to act.
- **Humans see everything**: You see all messages without being mentioned. Agents only see messages where they are `@mentioned`.
- **PM is your proxy**: Talk to `@pm` to coordinate. Let the PM `@mention` individual agents so you don't have to.
