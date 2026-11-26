import { Hono } from 'hono';
import { RateLimiterObject } from './do/rate-limiter-do';
import { RecallSessionObject } from './do/recall-session-do';
import { getRateLimiterStub, getSessionStub } from './do/stubs';
import type { Env } from './types';
import { RevisionCheckWorkflow } from './workflow';

export { RateLimiterObject, RecallSessionObject, RevisionCheckWorkflow };

const app = new Hono<{ Bindings: Env }>();

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
	return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? '127.0.0.1';
}

function getSessionId(c: { req: { header: (name: string) => string | undefined } }): string | null {
	const sessionId = c.req.header('X-Session-Id')?.trim();
	return sessionId && sessionId.length > 0 ? sessionId : null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

app.use('/api/*', async (c, next) => {
	const clientIp = getClientIp(c);
	const rateLimit = await getRateLimiterStub(c.env, clientIp).checkLimit(60, 60_000);

	c.header('X-RateLimit-Remaining', String(rateLimit.remaining));
	c.header('X-RateLimit-Reset', String(rateLimit.resetAt));

	if (!rateLimit.allowed) {
		const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
		c.header('Retry-After', String(retryAfterSeconds));
		return c.json({ error: 'Rate limit exceeded. Please try again later.' }, 429);
	}

	await next();
});

app.post('/api/review', async (c) => {
	const sessionId = getSessionId(c);
	if (!sessionId) {
		return c.json({ error: 'Missing X-Session-Id header' }, 400);
	}

	const contentType = c.req.header('Content-Type') ?? '';
	let noteContent = '';
	let noteId: string | undefined;
	let audioBase64 = '';

	if (contentType.includes('multipart/form-data')) {
		const formData = await c.req.formData();
		const rawContent = formData.get('noteContent');
		const rawNoteId = formData.get('noteId');
		const audioFile = formData.get('audio');

		noteContent = typeof rawContent === 'string' ? rawContent.trim() : '';
		noteId = typeof rawNoteId === 'string' && rawNoteId.trim().length > 0 ? rawNoteId.trim() : undefined;

		if (audioFile instanceof File) {
			if (audioFile.size > 1_000_000) {
				return c.json({ error: 'Audio file exceeds 1 MB limit' }, 413);
			}
			audioBase64 = arrayBufferToBase64(await audioFile.arrayBuffer());
		}
	} else {
		const body = await c.req.json<{ noteContent?: string; noteId?: string; audioBase64?: string }>().catch(() => null);
		if (body) {
			noteContent = typeof body.noteContent === 'string' ? body.noteContent.trim() : '';
			noteId = typeof body.noteId === 'string' && body.noteId.trim().length > 0 ? body.noteId.trim() : undefined;
			audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
		}
	}

	if (!noteContent || !audioBase64) {
		return c.json({ error: 'noteContent and audio are required' }, 400);
	}

	if (noteContent.length > 1000) {
		return c.json({ error: 'Note content exceeds 1000 character limit' }, 400);
	}

	const approxAudioBytes = Math.ceil((audioBase64.length * 3) / 4);
	if (approxAudioBytes > 1_000_000) {
		return c.json({ error: 'Audio file exceeds 1 MB limit' }, 413);
	}

	const sessionStub = getSessionStub(c.env, sessionId);
	const note = await sessionStub.upsertNote(noteContent, noteId);
	const review = await sessionStub.createReview(note.noteId, note.content);

	if (c.env.mindcup_audio_debug_storage) {
		const prefix = `reviews/${review.reviewId}`;
		await Promise.all([
			c.env.mindcup_audio_debug_storage.put(`${prefix}/note.txt`, note.content, {
				customMetadata: { sessionId, noteId: note.noteId, reviewId: review.reviewId },
			}),
			c.env.mindcup_audio_debug_storage.put(`${prefix}/audio.base64`, audioBase64, {
				customMetadata: { sessionId, noteId: note.noteId, reviewId: review.reviewId },
			}),
		]);
	}

	await c.env.REVISION_WORKFLOW.create({
		id: review.reviewId,
		params: {
			sessionId,
			noteId: note.noteId,
			reviewId: review.reviewId,
			noteSnapshot: note.content,
			audioBase64,
		},
	});

	return c.json(
		{
			reviewId: review.reviewId,
			noteId: note.noteId,
			status: review.status,
		},
		202,
	);
});

app.get('/api/reviews', async (c) => {
	const sessionId = getSessionId(c);
	if (!sessionId) {
		return c.json({ error: 'Missing X-Session-Id header' }, 400);
	}

	const noteId = c.req.query('noteId')?.trim() || undefined;
	const reviews = await getSessionStub(c.env, sessionId).listReviews(noteId);

	return c.json({ reviews }, 200);
});

app.get('/api/review/:reviewId', async (c) => {
	const sessionId = getSessionId(c);
	if (!sessionId) {
		return c.json({ error: 'Missing X-Session-Id header' }, 400);
	}

	const reviewId = c.req.param('reviewId');
	const review = await getSessionStub(c.env, sessionId).getReview(reviewId);

	if (!review) {
		return c.json({ error: 'Review not found' }, 404);
	}

	return c.json({ review }, 200);
});

app.get('/api/session', async (c) => {
	const sessionId = getSessionId(c);
	if (!sessionId) {
		return c.json({ error: 'Missing X-Session-Id header' }, 400);
	}

	const data = await getSessionStub(c.env, sessionId).getSessionData();
	return c.json({ sessionId, ...data }, 200);
});

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
