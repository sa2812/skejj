/**
 * LLM schedule generation wrapper.
 * Calls generateObject with aiScheduleSchema (OpenAI strict mode compatible)
 * and applies post-processing to convert to ScheduleInput before engine consumption.
 */

import { generateObject, NoObjectGeneratedError } from 'ai';
import type { LanguageModel } from 'ai';
import { aiScheduleSchema, applyScheduleDefaults } from '../schema.js';
import type { AiScheduleOutput, ScheduleInput } from '../schema.js';
import { checkReferentialIntegrity } from './integrity.js';

// Representative example embedded to avoid fs reads at runtime.
// ALL fields are present (including nullable ones set to null) so the LLM
// sees a complete example matching the strict schema.
const EXAMPLE_SCHEDULE = {
  id: 'roast-chicken-dinner',
  name: 'Roast Chicken Dinner',
  description: 'A classic Sunday roast with oven-constrained cooking steps.',
  defaultNumPeople: null,
  timeConstraint: { startTime: null, endTime: '2026-03-01T19:00:00' },
  tracks: [
    { id: 'mains', name: 'Mains' },
    { id: 'sides', name: 'Sides' },
  ],
  resources: [
    { id: 'oven', name: 'Oven', kind: 'Equipment', capacity: 1, roles: [] },
  ],
  steps: [
    {
      id: 'prep-chicken',
      title: 'Prep chicken',
      description: null,
      durationMins: 15,
      trackId: 'mains',
      timingPolicy: null,
      dependencies: [],
      resourceNeeds: [],
    },
    {
      id: 'roast-chicken',
      title: 'Roast chicken',
      description: null,
      durationMins: 90,
      trackId: 'mains',
      timingPolicy: null,
      dependencies: [{ stepId: 'prep-chicken', dependencyType: 'FinishToStart' }],
      resourceNeeds: [{ resourceId: 'oven', quantity: 1, minPeople: null, maxPeople: null }],
    },
    {
      id: 'prep-potatoes',
      title: 'Prep potatoes',
      description: null,
      durationMins: 20,
      trackId: 'sides',
      timingPolicy: null,
      dependencies: [],
      resourceNeeds: [],
    },
    {
      id: 'roast-potatoes',
      title: 'Roast potatoes',
      description: null,
      durationMins: 45,
      trackId: 'sides',
      timingPolicy: null,
      dependencies: [
        { stepId: 'prep-potatoes', dependencyType: 'FinishToStart' },
        { stepId: 'roast-chicken', dependencyType: 'FinishToStart' },
      ],
      resourceNeeds: [{ resourceId: 'oven', quantity: 1, minPeople: null, maxPeople: null }],
    },
  ],
};

function buildSystemPrompt(): string {
  return `You are a scheduling assistant. Generate a valid schedule JSON object based on the user's description.

CRITICAL FIELD NAMES (use exactly these — wrong names will cause validation errors):
- The schedule has a "steps" array (NOT "tasks")
- Each step has a "title" field (NOT "name")
- Each step has a "resourceNeeds" array (NOT "resourceAssignments")
- "dependencies" is an array of objects with shape: { "stepId": "<id>", "dependencyType": "FinishToStart" }
- Resources have a "kind" field (NOT "type"); valid values: "Equipment", "People", "Consumable"

RULES:
- All IDs must be unique kebab-case strings (e.g., "prepare-sauce", "cook-pasta")
- durationMins must be a positive integer
- Dependencies must only reference stepIds that exist in your steps array
- resourceNeeds must only reference resourceIds that exist in your resources array
- If there are no resources, set "resources" to []
- If there are no tracks, set "tracks" to []
- timingPolicy values: "Asap" or "Alap" (optional — set to null if not needed)
- dependencyType values: "FinishToStart", "StartToStart", "FinishToFinish", "StartToFinish"
- DO NOT reference stepIds or resourceIds that are not defined in your output
- For optional fields you don't need, set them to null (not undefined, not omitted)

EXAMPLE (follow this structure exactly — all fields must be present, use null for optional ones you don't need):
${JSON.stringify(EXAMPLE_SCHEDULE, null, 2)}

Output only valid JSON matching the schedule schema. No markdown, no explanation.`;
}

/**
 * Generate a ScheduleInput from a natural language description using an LLM.
 * Uses aiScheduleSchema (OpenAI strict mode compatible — all fields in required).
 * Post-processes LLM output via applyScheduleDefaults to convert nulls to
 * undefined/defaults before passing to the scheduling engine.
 * Validates the result against referential integrity.
 * Throws immediately on invalid output (no retry).
 */
export async function generateScheduleFromText(
  description: string,
  model: LanguageModel,
): Promise<ScheduleInput> {
  let result: ScheduleInput;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gen = generateObject as (opts: any) => Promise<{ object: AiScheduleOutput }>;
    const { object } = await gen({
      model,
      schema: aiScheduleSchema,
      system: buildSystemPrompt(),
      prompt: description,
    });
    // Convert nullable fields to undefined and apply array defaults
    result = applyScheduleDefaults(object);
  } catch (error) {
    if (error instanceof NoObjectGeneratedError) {
      throw new Error(`LLM did not produce valid schedule JSON: ${error.cause}`);
    }
    throw error;
  }

  // Validate referential integrity (throws on first violation with named reference)
  checkReferentialIntegrity(result);

  return result;
}
