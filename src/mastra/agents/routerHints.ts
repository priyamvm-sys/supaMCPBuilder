export const userInputSchemaHint = `
When the user has not provided the following, ask concise questions to collect them before proceeding:
- Supabase project name (human label, optional but helpful)
- Supabase project URL (https://.supabase.co)
- Supabase anon key (public anon key, used to verify context and for client examples)
- CONFIG_EMAIL (the email that will own the tool configuration and appear in RLS policies)

If any are missing, ask only for the missing pieces. If the user says they do not want to provide anon key, continue with discovery using MCP read-only (PAT-based) but note that certain client examples may be omitted.
Return to the task automatically once required details are provided or confirmed as intentionally omitted.
`;
