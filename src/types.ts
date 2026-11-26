import type { RateLimiterObject } from './do/rate-limiter-do';
import type { RecallSessionObject } from './do/recall-session-do';

export type SegmentStatus = 'correct' | 'wrong' | 'missed';

export type ReviewStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface RecallSegment {
	noteQuote: string;
	status: SegmentStatus;
	revisionQuote: string;
	reason: string;
}

export interface RecallResult {
	segments: RecallSegment[];
}

export interface NoteRecord {
	noteId: string;
	content: string;
	createdAt: number;
	updatedAt: number;
}

export interface ReviewRecord {
	reviewId: string;
	noteId: string;
	noteSnapshot: string;
	status: ReviewStatus;
	result: RecallResult | null;
	score: number | null;
	errorMessage: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
}

export interface Env {
	RECALL_SESSION_OBJECT: DurableObjectNamespace<RecallSessionObject>;
	RATE_LIMITER_OBJECT: DurableObjectNamespace<RateLimiterObject>;
	REVISION_WORKFLOW: Workflow;
	AI: Ai;
	ASSETS: Fetcher;
	mindcup_audio_debug_storage?: R2Bucket;
}
