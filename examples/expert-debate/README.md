# Expert Debate — Multi-Agent Panel Discussion

Use 4 AI agents as domain experts to debate and predict a topic (e.g., BTC price in 2027). Each agent argues from a distinct professional perspective, and a human moderator steers the discussion.

## Prerequisites

- Node.js 20+
- A coding agent with the [Skynet skill](../../skills/skynet/SKILL.md) loaded (e.g., Claude Code)

## Step 1: Set Up the Workspace

Give this prompt to your coding agent:

```
Use skynet to set up a workspace called "expert-debate" for a multi-expert panel discussion.

Create these members:
1. Agent "TechnicalAnalyst" (claude-code) — role: "Senior Crypto Technical Analyst", persona: "You are a veteran crypto technical analyst with 10+ years of experience. You focus on BTC halving cycles, Elliott Wave theory, logarithmic regression bands, historical price patterns, and on-chain metrics (MVRV, NUPL, exchange reserves, whale accumulation, HODL waves). You are data-obsessive and always back your arguments with specific indicators and historical precedents. When debating, present concrete price targets based on your models."
2. Agent "MacroEconomist" (claude-code) — role: "Macro Economist", persona: "You are a macroeconomist from a top investment bank. You analyze BTC through the lens of monetary policy, interest rates, inflation, dollar strength (DXY), and global liquidity cycles. You are moderately bullish on BTC as a macro asset but insist that macro conditions are the primary driver."
3. Agent "CryptoSkeptic" (claude-code) — role: "Crypto Skeptic & Risk Analyst", persona: "You are a seasoned risk analyst. You focus on regulatory crackdowns, CBDC competition, stablecoin systemic risks, and historical bubble patterns. You play devil's advocate and force the group to consider tail risks. Your bearish scenarios are well-reasoned, not emotional."
4. Agent "VCInvestor" (claude-code) — role: "Crypto VC Investor", persona: "You are a partner at a top-tier crypto venture capital firm. You focus on institutional adoption trends, ETF inflows, Bitcoin as treasury reserve asset, and Layer 2 ecosystem growth. You are structurally bullish because you see the adoption curve accelerating."
5. Human "moderator"

Start the workspace and all agents as daemons, then show me the status.
```

Once status shows all agents online, open a separate terminal:

```bash
npx @skynet-ai/cli@latest chat --name moderator --workspace expert-debate
```

## Step 2: Kick Off the Debate

Paste this in the chat to start:

```
@TechnicalAnalyst @MacroEconomist @CryptoSkeptic @VCInvestor

Welcome to the Expert Panel. Today's topic: "Predict the BTC price range by end of 2027."

Rules:
1. Each expert gives an opening statement with your predicted price range and core thesis (2-3 paragraphs).
2. After all opening statements, we enter cross-examination — challenge each other's assumptions.
3. Final round: each expert gives a revised prediction incorporating the debate.

Let's begin with opening statements. Go.
```

## Step 3: Moderate the Discussion

Guide the debate at key moments:

| When | What to say |
|------|-------------|
| After opening statements | `@TechnicalAnalyst @CryptoSkeptic Your predictions are furthest apart. Directly address each other's core assumptions.` |
| Deepen analysis | `@MacroEconomist What happens to your thesis if the Fed keeps rates elevated through 2027?` |
| Challenge consensus | `@CryptoSkeptic The bulls are converging around $X. What's the strongest bear case they're ignoring?` |
| Stress-test a thesis | `@TechnicalAnalyst Can your on-chain and cycle models account for a black swan like a major exchange collapse?` |
| Seek convergence | `@VCInvestor @MacroEconomist You both cite institutional adoption — where do you disagree on the timeline?` |
| Final round | `@TechnicalAnalyst @MacroEconomist @CryptoSkeptic @VCInvestor Final round. Give your revised 2027 BTC price range and confidence level (low/medium/high). Summarize in 1 paragraph.` |

## Step 4: Clean Up

Give this prompt to your coding agent:

```
Use skynet to stop all agents and the workspace "expert-debate".
```

## Customization

This template works for any debate topic. Swap out the agents to match your subject:

| Topic | Suggested Expert Roles |
|-------|----------------------|
| AI regulation | Policy maker, Tech CEO, Ethics researcher, Civil liberties advocate |
| Climate policy | Climate scientist, Economist, Energy executive, Activist |
| Startup strategy | Product manager, Growth hacker, CFO, Technical architect |
| Architecture review | Frontend lead, Backend lead, Security auditor, Product owner |

## Tips

- **@mention = activation**: Every `@name` costs compute. Only mention agents who need to act.
- **Humans see everything**: You see all messages without being mentioned. Agents only see messages where they are `@mentioned`.
- **Structured rounds work best**: Give clear instructions for each round so agents produce focused, comparable outputs.
- **Devil's advocate is essential**: Always include at least one contrarian role to prevent groupthink.
- **Persona drives quality**: The more specific the persona, the more differentiated and insightful each agent's contribution will be.
