import { DurableObject } from 'cloudflare:workers';
import type { Env, NoteRecord, RecallResult, ReviewRecord, ReviewStatus } from '../types';

type NoteRow = {
	note_id: string;
	content: string;
	created_at: number;
	updated_at: number;
};

type ReviewRow = {
	review_id: string;
	note_id: string;
	note_snapshot: string;
	status: ReviewStatus;
	result: string | null;
	score: number | null;
	error_message: string | null;
	created_at: number;
	updated_at: number;
};

function mapNoteRow(row: NoteRow): NoteRecord {
	return {
		noteId: row.note_id,
		content: row.content,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapReviewRow(row: ReviewRow): ReviewRecord {
	return {
		reviewId: row.review_id,
		noteId: row.note_id,
		noteSnapshot: row.note_snapshot,
		status: row.status,
		result: row.result ? (JSON.parse(row.result) as RecallResult) : null,
		score: row.score,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class RecallSessionObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS notes (
					note_id TEXT PRIMARY KEY,
					content TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
				CREATE TABLE IF NOT EXISTS reviews (
					review_id TEXT PRIMARY KEY,
					note_id TEXT NOT NULL,
					note_snapshot TEXT NOT NULL,
					status TEXT NOT NULL,
					result TEXT,
					score REAL,
					error_message TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
			`);
		});
	}

	async upsertNote(content: string, noteId: string = crypto.randomUUID()): Promise<NoteRecord> {
		const now = Date.now();
		this.ctx.storage.sql.exec(
			`INSERT INTO notes (note_id, content, created_at, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(note_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
			noteId,
			content,
			now,
			now,
		);
		return (await this.getNote(noteId))!;
	}

	async getNote(noteId: string): Promise<NoteRecord | null> {
		const rows = this.ctx.storage.sql
			.exec<NoteRow>('SELECT note_id, content, created_at, updated_at FROM notes WHERE note_id = ?', noteId)
			.toArray();
		return rows.length > 0 ? mapNoteRow(rows[0]) : null;
	}

	async listNotes(): Promise<NoteRecord[]> {
		const rows = this.ctx.storage.sql
			.exec<NoteRow>('SELECT note_id, content, created_at, updated_at FROM notes ORDER BY updated_at DESC')
			.toArray();
		return rows.map(mapNoteRow);
	}

	async createReview(noteId: string, noteSnapshot: string): Promise<ReviewRecord> {
		const reviewId = crypto.randomUUID();
		const now = Date.now();
		this.ctx.storage.sql.exec(
			`INSERT INTO reviews (review_id, note_id, note_snapshot, status, result, score, error_message, created_at, updated_at)
			 VALUES (?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)`,
			reviewId,
			noteId,
			noteSnapshot,
			now,
			now,
		);
		return (await this.getReview(reviewId))!;
	}

	async updateReviewStatus(
		reviewId: string,
		status: ReviewStatus,
		data?: { result?: RecallResult; score?: number; errorMessage?: string },
	): Promise<ReviewRecord | null> {
		const now = Date.now();
		const serializedResult = data?.result !== undefined ? JSON.stringify(data.result) : null;
		const score = data?.score ?? null;
		const errorMessage = data?.errorMessage ?? null;

		this.ctx.storage.sql.exec(
			`UPDATE reviews
			 SET status = ?,
			     result = COALESCE(?, result),
			     score = COALESCE(?, score),
			     error_message = COALESCE(?, error_message),
			     updated_at = ?
			 WHERE review_id = ?`,
			status,
			serializedResult,
			score,
			errorMessage,
			now,
			reviewId,
		);

		return this.getReview(reviewId);
	}

	async getReview(reviewId: string): Promise<ReviewRecord | null> {
		const rows = this.ctx.storage.sql
			.exec<ReviewRow>(
				'SELECT review_id, note_id, note_snapshot, status, result, score, error_message, created_at, updated_at FROM reviews WHERE review_id = ?',
				reviewId,
			)
			.toArray();
		return rows.length > 0 ? mapReviewRow(rows[0]) : null;
	}

	async listReviews(noteId?: string): Promise<ReviewRecord[]> {
		const rows = noteId
			? this.ctx.storage.sql
					.exec<ReviewRow>(
						'SELECT review_id, note_id, note_snapshot, status, result, score, error_message, created_at, updated_at FROM reviews WHERE note_id = ? ORDER BY created_at DESC',
						noteId,
					)
					.toArray()
			: this.ctx.storage.sql
					.exec<ReviewRow>(
						'SELECT review_id, note_id, note_snapshot, status, result, score, error_message, created_at, updated_at FROM reviews ORDER BY created_at DESC',
					)
					.toArray();
		return rows.map(mapReviewRow);
	}

	async getSessionData(): Promise<{ notes: NoteRecord[]; reviews: ReviewRecord[] }> {
		const [notes, reviews] = await Promise.all([this.listNotes(), this.listReviews()]);
		return { notes, reviews };
	}
}
