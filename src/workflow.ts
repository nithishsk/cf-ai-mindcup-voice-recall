import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getSessionStub } from './do/stubs';
import { buildEvaluationUserPrompt, buildRegenerationPrompt, EVALUATION_SYSTEM_PROMPT } from './lib/prompts';
import { computeRecallScore, validateRecallResult } from './lib/recall';
import type { Env, RecallResult } from './types';

export interface RevisionCheckParams {
	sessionId: string;
	noteId: string;
	reviewId: string;
	noteSnapshot: string;
	audioBase64: string;
}

const RECALL_JSON_SCHEMA = {
	type: 'object',
	properties: {
		segments: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					noteQuote: { type: 'string' },
					status: { type: 'string', enum: ['correct', 'wrong', 'missed'] },
					revisionQuote: { type: 'string' },
					reason: { type: 'string' },
				},
				required: ['noteQuote', 'status', 'revisionQuote', 'reason'],
				additionalProperties: false,
			},
		},
	},
	required: ['segments'],
	additionalProperties: false,
};

function parseModelJson(response: unknown): unknown {
	if (typeof response === 'object' && response !== null && 'response' in response) {
		const inner = (response as { response: unknown }).response;
		if (typeof inner === 'string') {
			return JSON.parse(inner);
		}
		return inner;
	}
	if (typeof response === 'string') {
		return JSON.parse(response);
	}
	return response;
}

export class RevisionCheckWorkflow extends WorkflowEntrypoint<Env, RevisionCheckParams> {
	async run(event: WorkflowEvent<RevisionCheckParams>, step: WorkflowStep): Promise<void> {
		const { sessionId, reviewId, noteSnapshot, audioBase64 } = event.payload;
		const sessionStub = getSessionStub(this.env, sessionId);

		try {
			await step.do('mark-processing', async () => {
				await sessionStub.updateReviewStatus(reviewId, 'processing');
			});

			const transcript = await step.do(
				'transcribe',
				{
					retries: {
						limit: 2,
						delay: '5 seconds',
						backoff: 'constant',
					},
				},
				async () => {
					const result = await this.env.AI.run('@cf/openai/whisper-large-v3-turbo', {
						audio: audioBase64,
						task: 'transcribe',
						language: 'en',
						vad_filter: true,
						initial_prompt: noteSnapshot.slice(0, 200),
					});

					const text = typeof result === 'object' && result !== null && 'text' in result ? String(result.text).trim() : '';
					if (!text) {
						throw new Error('Transcription returned empty text');
					}
					return text;
				},
			);

			const recallResult = await step.do(
				'evaluate',
				{
					retries: {
						limit: 2,
						delay: '5 seconds',
						backoff: 'constant',
					},
				},
				async (): Promise<RecallResult> => {
					const firstResponse = await this.env.AI.run('@cf/google/gemma-4-26b-a4b-it' as keyof AiModels, {
						messages: [
							{ role: 'system', content: EVALUATION_SYSTEM_PROMPT },
							{ role: 'user', content: buildEvaluationUserPrompt(noteSnapshot, transcript) },
						],
						response_format: {
							type: 'json_schema',
							json_schema: RECALL_JSON_SCHEMA,
						},
					} as never);

					let parsed: unknown;
					try {
						parsed = parseModelJson(firstResponse);
					} catch (err) {
						parsed = null;
					}

					const firstCheck = validateRecallResult(parsed, noteSnapshot);
					if (firstCheck.ok) {
						return firstCheck.data;
					}

					const regenPrompt = buildRegenerationPrompt(
						noteSnapshot,
						transcript,
						JSON.stringify(parsed ?? firstResponse),
						firstCheck.error,
					);

					const secondResponse = await this.env.AI.run('@cf/google/gemma-4-26b-a4b-it' as keyof AiModels, {
						messages: [
							{ role: 'system', content: EVALUATION_SYSTEM_PROMPT },
							{ role: 'user', content: regenPrompt },
						],
						response_format: {
							type: 'json_schema',
							json_schema: RECALL_JSON_SCHEMA,
						},
					} as never);

					const secondParsed = parseModelJson(secondResponse);
					const secondCheck = validateRecallResult(secondParsed, noteSnapshot);
					if (!secondCheck.ok) {
						throw new Error(`Evaluation validation failed after regeneration: ${secondCheck.error}`);
					}

					return secondCheck.data;
				},
			);

			await step.do('persist', async () => {
				const score = computeRecallScore(recallResult.segments);
				await sessionStub.updateReviewStatus(reviewId, 'completed', {
					result: recallResult,
					score,
				});
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown workflow error';
			await sessionStub.updateReviewStatus(reviewId, 'failed', {
				errorMessage: message,
			});
		}
	}
}
