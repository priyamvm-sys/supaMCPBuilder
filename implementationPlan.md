# Mastra Agent Network with detailed, production-grade prompts (aligned to your original generate-prompt function)

Below is a fully updated plan and code scaffold with deeply detailed, operational prompts for each agent and the network. Prompts are tailored to your original discovery-only flow, strict tools JSON generation, and SQL/RLS setup requirements. The agent network runs in the Mastra Playground, asks for missing Supabase context (project name, URL, anon key, user email), and connects to Supabase’s official MCP server using an admin PAT in env.

Note: Where your original generate-prompt function had specific rules, they are preserved and expanded in-line under “Instructions” for each agent. Prompts are designed to be self-sufficient and enforce your constraints without relying on out-of-band context.

## Project structure

- package.json
- tsconfig.json
- .env.local (not committed)
- src/
  - agents/
    - discoveryAgent.ts
    - configAgent.ts
    - sqlRlsAgent.ts
    - routerHints.ts
  - mcp/
    - supabaseMcp.ts
  - network/
    - supabaseMcpNetwork.ts
  - index.ts

## Environment and install

- npm install @mastra/core @mastra/mcp @ai-sdk/openai
- .env.local
  - OPENAI_API_KEY=...
  - SUPABASE_ACCESS_TOKEN=... (Supabase PAT with admin scope)
  - Optional SUPABASE_PROJECT_REF=... (to scope read-only discovery)

## MCP client (Supabase server invocation)

- Uses stdio via npx.
- Two servers:
  - supabase-ro for read-only discovery (optionally project-scoped).
  - supabase-admin for SQL/RLS execution.

src/mcp/supabaseMcp.ts
```ts
import { MCPClient } from '@mastra/mcp';

const projectRef = process.env.SUPABASE_PROJECT_REF;

export const mcp = new MCPClient({
  servers: {
    'supabase-ro': {
      command: 'npx',
      args: projectRef
        ? ['-y', '@supabase/mcp-server-supabase@latest', '--read-only', '--project-ref', projectRef]
        : ['-y', '@supabase/mcp-server-supabase@latest', '--read-only'],
      env: {
        SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN || '',
      },
    },
    'supabase-admin': {
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase@latest'],
      env: {
        SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN || '',
      },
    },
  },
  timeout: 120_000,
});
```

## Agent prompts and behaviors

The prompts below are intentionally explicit and actionable, reflecting your original generate-prompt function’s tone and constraints.

src/agents/routerHints.ts
```ts
export const userInputSchemaHint = `
When the user has not provided the following, ask concise questions to collect them before proceeding:
- Supabase project name (human label, optional but helpful)
- Supabase project URL (https://.supabase.co)
- Supabase anon key (public anon key, used to verify context and for client examples)
- CONFIG_EMAIL (the email that will own the tool configuration and appear in RLS policies)

If any are missing, ask only for the missing pieces. If the user says they do not want to provide anon key, continue with discovery using MCP read-only (PAT-based) but note that certain client examples may be omitted.
Return to the task automatically once required details are provided or confirmed as intentionally omitted.
`;
```

### Discovery Agent

- Role: strict discovery-only; enumerate what exists without creation or suggestions.
- Uses Supabase MCP read-only tools.
- Output: compact, schema-accurate discovery JSON for next agent.

src/agents/discoveryAgent.ts
```ts
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { mcp } from '../mcp/supabaseMcp';
import { userInputSchemaHint } from './routerHints';

export const discoveryAgent = new Agent({
  name: 'supabase-discovery',
  description: 'Discovery-only: Enumerates existing Supabase capabilities for safe tooling.',
  instructions: `
${userInputSchemaHint}

You are a discovery-only agent working against a Supabase project via the official Supabase MCP server (read-only).
ABSOLUTE RULES:
- Do NOT create, mutate, or suggest new business logic.
- Only surface capabilities that already exist and are safe to expose.
- Return a compact, machine-consumable JSON object named "discovery".
- If you lack sufficient permissions or a tool errors, report "limitations" with exact tool name and error text.

Discovery priorities (in order):
1) Edge Functions:
   - List existing edge functions and basic metadata (name, deployed status).
   - Do NOT infer parameters or routes unless available via tools.
2) Database Functions (RPC):
   - For each function: name, schema, argument names and types, return type, volatility (if available), and required roles.
   - Only include the subset that is callable by service role or anon role (if discernible via tools).
3) Tables and Relationships:
   - For each table: columns (name, type, nullable, default), primary key, foreign keys (table, column, constraint), unique indexes (if available).
   - Identify relationships via foreign keys only; do NOT guess implicit relationships.
4) RLS:
   - For each table: RLS enabled flag, and list existing policies (name, command, using, with_check).
5) Sensitive data:
   - Identify columns likely containing PII by name patterns (email, name, phone, address) and explicit constraints; list them as "sensitive_columns" per table (do NOT invent).
6) Feature flags / Extensions:
   - List notable enabled extensions relevant to client tooling (e.g., http, pg_graphql) if discoverable.

Output JSON shape (strict):
{
  "edge_functions": [ { "name": string, "status": "deployed" | "unknown" } ],
  "db_functions": [ { "schema": string, "name": string, "args": [ { "name": string, "type": string } ], "returns": string, "volatility": string | null } ],
  "tables": [
    {
      "schema": string,
      "name": string,
      "columns": [ { "name": string, "type": string, "nullable": boolean, "default": string | null } ],
      "primary_key": [string] | null,
      "foreign_keys": [ { "constraint": string, "columns": [string], "ref_table": string, "ref_columns": [string] } ],
      "unique_indexes": [ { "name": string, "columns": [string] } ] | [],
      "rls_enabled": boolean,
      "policies": [ { "name": string, "command": "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE", "using": string | null, "with_check": string | null } ],
      "sensitive_columns": [string]
    }
  ],
  "extensions": [ { "name": string, "version": string | null } ],
  "limitations": [ { "tool": string, "error": string } ]
}

Process:
- Use only Supabase MCP read-only tools exposed to you.
- If a field is not available, use null or empty arrays; never guess.
- Keep the JSON under 50KB by omitting verbose internal metadata and truncating overly large lists after 200 items with a note in "limitations".
- Return ONLY the discovery JSON, no prose.
`,
  model: openai('gpt-4o'),
  tools: async () => {
    const tools = await mcp.tools();
    const roTools = Object.fromEntries(
      Object.entries(tools).filter(([k]) => k.startsWith('supabase-ro'))
    );
    return roTools;
  },
});
```

### Config Generator Agent

- Role: convert discovery into tools array JSON suitable for an MCP client using Supabase JS semantics.
- Enforces: update-splitting, advanced filters, relationships based strictly on FKs, response modifiers, pagination, ordering; uses RPC for aggregations; no SQL in tools.

src/agents/configAgent.ts
```ts
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

export const configAgent = new Agent({
  name: 'tools-config-generator',
  description: 'Generates safe tools array JSON from discovery, following strict exposure rules.',
  instructions: `
Input: a "discovery" JSON produced by the discovery agent.

Mission:
- Produce a "tools" array JSON defining only the operations derivable from discovery.
- Prioritize READ operations; include WRITE only when tables have clear primary keys and RLS policies allow safe scoped updates/inserts (avoid if ambiguous).
- Every tool must correspond to an actual, discovered table, relationship, or RPC function.

Rules (strict, aligned to original spec):
- No speculative endpoints or fields. If not explicitly discovered, do not expose it.
- Relationships: only through explicit foreign keys; do not infer many-to-many without a discovered join table.
- Filters: support eq, neq, lt, lte, gt, gte, like, ilike, in, is, contains, containedBy; only for columns present in discovery.
- Ordering: allow order by discovered columns; default ascending; allow nullsFirst/nullsLast flags.
- Pagination: include limit and offset.
- Response modifiers: select columns explicitly; allow nested selects only for FK relationships present in discovery.
- Updates: split into granular tools where each template variable is required; do not allow mass updates without a restrictive filter on a primary key or unique column.
- Aggregations: only via discovered RPC/db_functions; do not create SQL or use group-by patterns here.
- Security:
  - If a table has RLS disabled, assume service role required; mark "requires_service_role": true on tools.
  - If RLS enabled, do not assume permissive access; add "caveats" describing policy names relevant to the operation.
- Sensitive columns: do not expose write access to columns flagged as sensitive unless clearly required and safe; reading may be allowed but avoid including them by default in select lists.

Output format (strict):
{
  "tools": [
    {
      "name": string,
      "description": string,
      "operation": "select" | "insert" | "update" | "delete" | "rpc",
      "resource": { "schema": string, "table"?: string, "function"?: string },
      "inputs": { ...templateVarsWithTypes },
      "filters": [ { "column": string, "op": "eq"|"neq"|"lt"|"lte"|"gt"|"gte"|"like"|"ilike"|"in"|"is"|"contains"|"containedBy" } ],
      "select": [string], // default selected columns; omit sensitive by default
      "order": { "by": string, "ascending": boolean, "nulls": "first" | "last" | "auto" },
      "pagination": { "limit": number, "offset": number },
      "relationships": [ { "from_column": string, "to_table": string, "to_column": string } ],
      "requires_service_role": boolean,
      "caveats": [string]
    }
  ]
}

Method:
- Read discovery JSON.
- Compose tools for:
  - Safe, paginated SELECT for each table with explicit select columns (exclude sensitive by default).
  - UPDATE tools only when primary key is present; require pk in inputs; split updates so each updatable column is its own tool, requiring pk + new value.
  - INSERT tools only for tables without sensitive columns or with minimal required fields; never include server-managed defaults in inputs.
  - DELETE tools only when pk exists and RLS indicates safe scope; otherwise omit.
  - RPC tools for discovered db_functions; inputs mirror discovered args and return is described textually (no schema inference).
- Keep the array concise and predictable; avoid generating more than 100 tools. If exceeding, prioritize tables with RLS enabled and referenced by FKs.

Return ONLY the JSON with "tools".
`,
  model: openai('gpt-4o'),
});
```

### SQL/RLS Agent

- Role: generate and optionally execute SQL for tool_configurations table with RLS.
- Enforces: creation only of tool_configurations, indexes, RLS enablement, 4 policies; never touch business tables.

src/agents/sqlRlsAgent.ts
```ts
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { mcp } from '../mcp/supabaseMcp';
import { userInputSchemaHint } from './routerHints';

export const sqlRlsAgent = new Agent({
  name: 'sql-rls-setup',
  description: 'Creates tool_configurations with indexes and RLS policies; can execute via admin MCP.',
  instructions: `
${userInputSchemaHint}

Inputs expected:
- CONFIG_EMAIL (email who owns the configuration; used in policies)
- execute (boolean: if true, run SQL via Supabase MCP admin; else return SQL)
- tools JSON (optional: for immediate insertion; if not provided, only create table/policies)

Hard constraints:
- Only operate on a new admin-owned table named "tool_configurations".
- Do NOT modify or drop any existing business tables or policies.
- SQL must be idempotent where possible (use IF NOT EXISTS on create).

Schema to create:
- Table: tool_configurations
  columns:
    - id bigint generated always as identity primary key
    - email text not null
    - project_name text
    - version int not null default 1
    - tools jsonb not null
    - is_active boolean not null default true
    - created_at timestamptz not null default now()
    - updated_at timestamptz not null default now()
  indexes:
    - idx_tool_configurations_email (email)
    - idx_tool_configurations_is_active (is_active)
    - uq_tool_config_active_per_email (unique null-filtered on (email) where is_active=true) if supported; otherwise enforce in logic at insert time
- RLS:
  - enable row level security on tool_configurations
  - Policies (4):
    1) select_own_active: allow SELECT where email = auth.email()
    2) insert_own: allow INSERT where new.email = auth.email()
    3) update_own: allow UPDATE where email = auth.email()
    4) deactivate_own: optional policy to allow SET is_active=false where email = auth.email()
  - Note: If auth.email() is unavailable (service role or disabled), annotate limitation in output.

Outputs:
- Always return:
  {
    "sql": "....",
    "executed": boolean,
    "execution_result": string | null,
    "notes": [string]
  }

If execute=true:
- Attempt to run the SQL via admin MCP SQL tool.
- If execution partially fails, include the exact error text and still return the SQL.

Optional insertion (when tools JSON and CONFIG_EMAIL provided):
- Provide a separate parameterized SQL snippet to:
  1) set is_active=false where email=CONFIG_EMAIL and is_active=true
  2) insert a new row with next version = coalesce(max(version)+1, 1)
- If asked to execute, attempt to run; else return the snippet as "insert_sql".
- Never insert if table creation failed.

Return ONLY the JSON object described above.
`,
  model: openai('gpt-4o'),
  tools: async () => {
    const tools = await mcp.tools();
    const adminTools = Object.fromEntries(
      Object.entries(tools).filter(([k]) => k.startsWith('supabase-admin'))
    );
    return adminTools;
  },
});
```

## Agent Network with orchestration prompt

- Role: orchestrates the 3 agents, handles missing inputs, and maintains flow.
- Playground entry point.

src/network/supabaseMcpNetwork.ts
```ts
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
  model: openai('gpt-4o'),
  agents: [discoveryAgent, configAgent, sqlRlsAgent],
});
```

## Mastra entry point for Playground

src/index.ts
```ts
import { Mastra } from '@mastra/core';
import { supabaseMcpNetwork } from './network/supabaseMcpNetwork';
import { discoveryAgent } from './agents/discoveryAgent';
import { configAgent } from './agents/configAgent';
import { sqlRlsAgent } from './agents/sqlRlsAgent';

export const mastra = new Mastra({
  agents: {
    discoveryAgent,
    configAgent,
    sqlRlsAgent,
  },
  networks: {
    supabaseMcpNetwork,
  },
});
```

## package.json

```json
{
  "name": "mastra-supabase-mcp",
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "mastra dev",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@ai-sdk/openai": "latest",
    "@mastra/core": "latest",
    "@mastra/mcp": "latest"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.4.0"
  }
}
```

## Usage in Mastra Playground

- Set environment variables:
  - OPENAI_API_KEY
  - SUPABASE_ACCESS_TOKEN
  - Optional SUPABASE_PROJECT_REF
- npm run dev
- Open the Playground, choose “supabase-mcp-configurator”
- Provide:
  - Project name (optional)
  - Supabase URL
  - Anon key (optional; okay to omit)
  - CONFIG_EMAIL
- Sample flow:
  - “Discover my project: URL=https://xyz.supabase.co, anon key=, email=user@example.com.”
  - “Generate the tools JSON from the discovery.”
  - “Create the tool_configurations table and RLS; do not execute yet.”
  - “Now execute the SQL.”
  - “Insert this tools JSON as my next active configuration.”

## Notes and guardrails encoded in prompts

- Discovery agent refuses to create or infer beyond discovered artifacts.
- Config generator enforces update-splitting, safe filters, FK-only relationships, and RPC-only aggregations.
- SQL agent touches only tool_configurations and RLS policies, with idempotency and explicit policy semantics.
- Network keeps the conversation tight, collects only missing inputs, and returns strictly structured outputs for copy/paste or automation.

If additional verbiage from your original generate-prompt function should be mirrored verbatim (e.g., specific policy names, column-by-column exclusions, or response-shaping defaults), paste those clauses into the corresponding “Rules” sections above for the configAgent and sqlRlsAgent to further harden behavior.