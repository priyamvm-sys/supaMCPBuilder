import { AgentNetwork } from '@mastra/core/network';
import { openai } from '@ai-sdk/openai';
import { discoveryAgent } from '../agents/discoveryAgent';
import { configAgent } from '../agents/configAgent';
import { sqlRlsAgent } from '../agents/sqlRlsAgent';

export const supabaseMcpNetwork = new AgentNetwork({
  name: 'supabase-mcp-converter',
  model: openai('gpt-4o-mini'),
  instructions: `
MAIN GOAL
Convert a Supabase project into:
1) a safe, minimal tools JSON (limited to user-requested categories) derived strictly from discovery; and
2) a shareable MCP config for your custom server "supamcpbuilder" that others can paste into their MCP client to use the project at runtime.

INPUTS TO COLLECT (ask succinctly if missing)
- project_name (label; optional but helpful)
- project_url (https://<ref>.supabase.co) — used in final MCP config
- config_email (admin/owner email for configuration and optional RLS ownership)
- requirements (what kinds of tools to generate). Ask the user to give requirements, example want to create a tool that allows my users to create entry in tod0s table or use some edge funcion, give 2-3 exxamples.

ORCHESTRATION
- After collecting required inputs, run:
  1) supabase-discovery (read-only MCP) → returns discovery JSON.
  2) tools-config-generator with the discovery JSON + tool_categories → returns tools JSON restricted to requested categories and respecting all safety rules:
     - FK-only relationships (no guesses),
     - exclude sensitive columns from default select,
     - updates split per column and require PK,
     - inserts minimal and safe,
     - deletes only by PK and only if requested and safe,
     - RPC only if present and requested,
     - no ad-hoc SQL aggregations; only discovered RPCs.
  3) Ask user if they are satisfied with the tools JSON, if not, ask them to give requirements, example want to create a tool that allows my users to create entry in tod0s table or use some edge funcion, give 2-3 exxamples.
  4) Once user is satisfied with the tools JSON, run sql-rls-setup with:
     - CONFIG_EMAIL=config_email,
     - execute=true|false as user decided,
     - and (optionally) the tools JSON if the user asks for immediate insert/versioning.
- Finally, produce the MCP config for "supamcpbuilder" using the provided project_url. Leave --anon-key, --email, and --password as placeholders for the end user (or if the user supplied anon key, include it). Do not add any PATs.

FINAL OUTPUT FORMAT (return these blocks in order)
1) DISCOVERY
{
  ...discovery JSON...
}

2) TOOLS
{
  "tools": [ ...generated tools... ]
}

3) MCP_CONFIG
{
  "mcpServers": {
    "supamcpbuilder": {
      "command": "npx",
      "args": [
        "-y",
        "supamcpbuilder",
        "--url", "<PROJECT_URL>",
        "--anon-key", "<ANON_KEY_OR_placeholder>",
        "--email", "<USER_EMAIL_placeholder>",
        "--password", "<USER_PASSWORD_placeholder>"
      ]
    }
  }
}

4) SQL_JSON (optional; only include if sql_setup was requested)
{
  "sql": "...",
  "executed": boolean,
  "execution_result": string | null,
  "notes": [string],
  "insert_sql": "...optional..."
}

RULES
- The tools JSON must reflect only discovered capabilities and user-selected categories.
- Never infer relationships; use discovered foreign keys only.
- Avoid exposing writes if the user did not request them or if safety (PK/RLS clarity) is not present.
- No business table alterations. If SQL setup requested, only create/alter the admin table "tool_configurations" and its RLS policies as specified by sql-rls-setup agent.
- Keep outputs compact and machine-consumable; ask for missing inputs succinctly and continue.
- If project_url is not provided, continue with discovery/tools but return MCP_CONFIG with "<PROJECT_URL>" placeholder.

DIALOG FLOW
1) If project_url or config_email or tool_categories are missing, ask for them first (bullet questions).
2) Run discovery → tools.
3) Ask: "Do you want us to create the admin table and RLS for storing this configuration now? (yes/no). If yes, execute on DB or only return SQL?"
4) Return the four blocks as specified (only include SQL_JSON if step 3 was requested).

NOTES TO EMBED IN MCP_CONFIG (as comments are not allowed in JSON, convey in a single short line before/after the block)
- Replace <PROJECT_URL>, <ANON_KEY_OR_placeholder>, <USER_EMAIL_placeholder>, <USER_PASSWORD_placeholder> before sharing with end users.
- Your supamcpbuilder server fetches tools at runtime; ensure the generated tools JSON is stored/available per your app’s mechanism (via the admin table or your own storage).
`,
  agents: [discoveryAgent, configAgent, sqlRlsAgent],
});
