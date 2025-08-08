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
  model: openai('gpt-4o-mini'),
  tools: await mcp.getTools(),
});
