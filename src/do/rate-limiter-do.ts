import { DurableObject } from 'cloudflare:workers';
import type { Env, RateLimitResult } from '../types';

export class RateLimiterObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS rate_limits (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					count INTEGER NOT NULL,
					window_start INTEGER NOT NULL
				)
			`);
		});
	}

	async checkLimit(limit = 10, windowMs = 60_000): Promise<RateLimitResult> {
		const now = Date.now();
		const rows = this.ctx.storage.sql
			.exec<{ count: number; window_start: number }>('SELECT count, window_start FROM rate_limits WHERE id = 1')
			.toArray();

		if (rows.length === 0 || now - rows[0].window_start >= windowMs) {
			this.ctx.storage.sql.exec(
				`INSERT INTO rate_limits (id, count, window_start)
				 VALUES (1, 1, ?)
				 ON CONFLICT(id) DO UPDATE SET count = 1, window_start = excluded.window_start`,
				now,
			);
			return {
				allowed: true,
				remaining: Math.max(0, limit - 1),
				resetAt: now + windowMs,
			};
		}

		const { count, window_start } = rows[0];
		const resetAt = window_start + windowMs;

		if (count >= limit) {
			return {
				allowed: false,
				remaining: 0,
				resetAt,
			};
		}

		const nextCount = count + 1;
		this.ctx.storage.sql.exec('UPDATE rate_limits SET count = ? WHERE id = 1', nextCount);

		return {
			allowed: true,
			remaining: Math.max(0, limit - nextCount),
			resetAt,
		};
	}
}
