export const EVALUATION_SYSTEM_PROMPT = `You are an active-recall evaluator. Compare the user's spoken revision transcript against their study note.
Return ONLY valid JSON matching the required schema:
{
  "segments": [
    {
      "noteQuote": "exact verbatim quote from the study note as it's present in the note.",
      "status": "correct" | "wrong" | "missed",
      "revisionQuote": "exact quote from the spoken transcript (or empty string if missed)",
      "reason": "max 1 concise sentence explaining why"
    }
  ]
}

Rules:
- Cover all important concepts from the study note (100% word-for-word coverage is not required).
- Every "noteQuote" MUST appear verbatim in the study note.
- "status" must be "correct", "wrong", or "missed".
- "reason" must be at most 1 sentence.`;

export function buildEvaluationUserPrompt(noteSnapshot: string, transcript: string): string {
	return `Study Note:\n"""\n${noteSnapshot}\n"""\n\nSpoken Revision Transcript:\n"""\n${transcript}\n"""`;
}

export function buildRegenerationPrompt(
	noteSnapshot: string,
	transcript: string,
	previousOutput: string,
	validationError: string,
): string {
	return `Your previous JSON output failed validation:
${validationError}

Previous output:
${previousOutput}

Fix the output so that:
1. It is valid JSON matching the schema.
2. Every "noteQuote" appears verbatim in the Study Note below.

Study Note:
"""
${noteSnapshot}
"""

Spoken Revision Transcript:
"""
${transcript}
"""`;
}
