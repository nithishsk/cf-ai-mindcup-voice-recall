import type { Env } from '../types';
import type { RateLimiterObject } from './rate-limiter-do';
import type { RecallSessionObject } from './recall-session-do';

export function getSessionStub(env: Env, sessionId: string): DurableObjectStub<RecallSessionObject> {
	const id = env.RECALL_SESSION_OBJECT.idFromName(sessionId);
	return env.RECALL_SESSION_OBJECT.get(id);
}

export function getRateLimiterStub(env: Env, clientIp: string): DurableObjectStub<RateLimiterObject> {
	const id = env.RATE_LIMITER_OBJECT.idFromName(clientIp);
	return env.RATE_LIMITER_OBJECT.get(id);
}
