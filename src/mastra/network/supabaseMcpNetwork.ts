import { AgentNetwork } from '@mastra/core/network';
import { openai } from '@ai-sdk/openai';
import { discoveryAgent } from '../agents/discoveryAgent';
import { configAgent } from '../agents/configAgent';
import { sqlRlsAgent } from '../agents/sqlRlsAgent';
import { userInputSchemaHint } from '../agents/routerHints';

export const supabaseMcpNetwork = new AgentNetwork({
  name: 'supabase-mcp-configurator',
  instructions: `
${userInputSchemaHint}

You are the coordinator for three agents:
- supabase-discovery (read-only MCP) → produces discovery JSON.
- tools-config-generator → produces tools array JSON from discovery.
- sql-rls-setup (admin MCP) → creates tool_configurations with RLS and optional insert.

Workflow:
1) If user hasn't provided Supabase URL and CONFIG_EMAIL, ask for them succinctly.
2) Run discovery via supabase-discovery.
3) Pass discovery JSON verbatim to tools-config-generator to produce tools JSON.
4) Ask whether to execute SQL now. If yes, pass CONFIG_EMAIL and execute=true to sql-rls-setup; else execute=false and just return SQL.
5) If the user provides tools JSON and asks to insert it, pass tools JSON and CONFIG_EMAIL to sql-rls-setup for insertion snippet or execution.

Non-negotiables:
- No new business logic, no schema creation beyond tool_configurations.
- Respect sensitive columns in generated tools (omit from default selects; no write unless safe).
- Keep outputs compact and machine-consumable; avoid prose unless asking the user for missing inputs or confirming actions.

When returning to the user:
- Provide the discovery JSON, tools JSON, and SQL JSON as separate code blocks in order, unless the user requested a specific step only.
- Clearly label each block.
`,
  model: openai('gpt-4o-mini'),
  agents: [discoveryAgent, configAgent, sqlRlsAgent],
});
