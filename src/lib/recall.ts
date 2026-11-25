import { z } from 'zod';
import type { RecallResult, RecallSegment } from '../types';

export const RecallSegmentSchema = z.object({
	noteQuote: z.string().min(1),
	status: z.enum(['correct', 'wrong', 'missed']),
	revisionQuote: z.string(),
	reason: z.string().min(1),
});

export const RecallResultSchema = z.object({
	segments: z.array(RecallSegmentSchema).min(1),
});

function normalizeText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findMissingNoteQuotes(segments: RecallSegment[], noteSnapshot: string): string[] {
	const normalizedNote = normalizeText(noteSnapshot);
	const missing: string[] = [];

	for (const segment of segments) {
		const normalizedQuote = normalizeText(segment.noteQuote);
		if (!normalizedQuote || !normalizedNote.includes(normalizedQuote)) {
			missing.push(segment.noteQuote);
		}
	}

	return missing;
}

export function validateRecallResult(raw: unknown, noteSnapshot: string): { ok: true; data: RecallResult } | { ok: false; error: string } {
	const parsed = RecallResultSchema.safeParse(raw);
	if (!parsed.success) {
		return { ok: false, error: `Schema validation failed: ${parsed.error.message}` };
	}

	const missingQuotes = findMissingNoteQuotes(parsed.data.segments, noteSnapshot);
	if (missingQuotes.length > 0) {
		return {
			ok: false,
			error: `These noteQuote values were not found in the study note: ${missingQuotes.map((q) => `"${q}"`).join(', ')}`,
		};
	}

	return { ok: true, data: parsed.data };
}

export function computeRecallScore(segments: RecallSegment[]): number {
	if (segments.length === 0) return 0;
	const correctCount = segments.filter((segment) => segment.status === 'correct').length;
	return Math.round((correctCount / segments.length) * 100);
}
