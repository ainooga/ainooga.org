import { getContext, setContext } from 'svelte';
import type { PollService } from './types';
import type { PollRuntime } from './runtime';
export const POLL_SERVICES = Symbol('poll-services');
export interface PollServices {
  api: PollService;
  runtime: PollRuntime;
}
export function setPollServices(services: PollServices) {
  setContext(POLL_SERVICES, services);
}
export function getPollServices(): PollServices {
  return getContext<PollServices>(POLL_SERVICES);
}
