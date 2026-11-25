import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvaluationUserPrompt, buildRegenerationPrompt } from './prompts';
import { computeRecallScore, findMissingNoteQuotes, validateRecallResult } from './recall';

const UPSC_NOTE = readFileSync(resolve(process.cwd(), 'public/samples/upsc-note.txt'), 'utf-8').trim();

describe('computeRecallScore', () => {
	it('returns 0 for empty segments', () => {
		expect(computeRecallScore([])).toBe(0);
	});

	it('computes percentage of correct segments', () => {
		expect(
			computeRecallScore([
				{ noteQuote: 'a', status: 'correct', revisionQuote: 'a', reason: 'ok' },
				{ noteQuote: 'b', status: 'wrong', revisionQuote: 'x', reason: 'wrong' },
				{ noteQuote: 'c', status: 'missed', revisionQuote: '', reason: 'missed' },
			]),
		).toBe(33);

		expect(
			computeRecallScore([
				{ noteQuote: 'a', status: 'correct', revisionQuote: 'a', reason: 'ok' },
				{ noteQuote: 'b', status: 'correct', revisionQuote: 'b', reason: 'ok' },
			]),
		).toBe(100);
	});
});

describe('validateRecallResult with UPSC demo note', () => {
	it('accepts valid segments with verbatim quotes', () => {
		const raw = {
			segments: [
				{
					noteQuote: 'Sovereign, Socialist, Secular, Democratic Republic',
					status: 'correct',
					revisionQuote: 'India is a sovereign socialist secular democratic republic',
					reason: 'Accurately recalled all five terms.',
				},
				{
					noteQuote: '42nd Constitutional Amendment Act of 1976',
					status: 'missed',
					revisionQuote: '',
					reason: 'Did not mention the 42nd Amendment.',
				},
			],
		};

		const result = validateRecallResult(raw, UPSC_NOTE);
		expect(result.ok).toBe(true);
	});

	it('rejects segments whose noteQuote is not in the note', () => {
		const missing = findMissingNoteQuotes(
			[
				{
					noteQuote: 'Article 370 was abrogated in 2019',
					status: 'wrong',
					revisionQuote: 'something',
					reason: 'Not in note.',
				},
			],
			UPSC_NOTE,
		);
		expect(missing).toEqual(['Article 370 was abrogated in 2019']);

		const result = validateRecallResult(
			{
				segments: [
					{
						noteQuote: 'Article 370 was abrogated in 2019',
						status: 'wrong',
						revisionQuote: 'something',
						reason: 'Not in note.',
					},
				],
			},
			UPSC_NOTE,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Article 370 was abrogated in 2019');
		}
	});

	it('rejects invalid schema', () => {
		const result = validateRecallResult({ wrongKey: [] }, UPSC_NOTE);
		expect(result.ok).toBe(false);
	});
});

describe('prompt builders', () => {
	it('includes note and transcript in evaluation prompt', () => {
		const prompt = buildEvaluationUserPrompt(UPSC_NOTE, 'India is a sovereign republic.');
		expect(prompt).toContain(UPSC_NOTE);
		expect(prompt).toContain('India is a sovereign republic.');
	});

	it('includes validation error and previous output in regeneration prompt', () => {
		const prompt = buildRegenerationPrompt(UPSC_NOTE, 'transcript', '{"bad":true}', 'Missing segments');
		expect(prompt).toContain('Missing segments');
		expect(prompt).toContain('{"bad":true}');
	});
});
