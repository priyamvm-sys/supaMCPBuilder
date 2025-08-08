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
