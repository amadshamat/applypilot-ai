import type { HealthResponse } from '@applypilot/ai-core';

export function describeProvider(health: HealthResponse): string {
  return health.provider === 'mock'
    ? 'Mock mode: free drafts made offline from your own profile text. Nothing is billed.'
    : `Claude (${health.model}). Requests are billed to the Anthropic account set up on the API. ${health.requestsToday} of ${health.dailyLimit} requests used today.`;
}
