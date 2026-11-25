import type { RecallSegment } from '../types';

export function computeRecallScore(segments: RecallSegment[]): number {
	if (segments.length === 0) return 0;
	const correctCount = segments.filter((segment) => segment.status === 'correct').length;
	return Math.round((correctCount / segments.length) * 100);
}
