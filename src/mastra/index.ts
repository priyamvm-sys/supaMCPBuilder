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