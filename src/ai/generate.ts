/**
 * LLM schedule generation wrapper.
 * Calls generateObject with scheduleSchema and validates referential integrity.
 */

import { generateObject, NoObjectGeneratedError } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { scheduleSchema } from '../schema';
import type { ScheduleInput } from '../schema';
import { checkReferentialIntegrity } from './integrity';

// Representative example embedded to avoid fs reads at runtime
const EXAMPLE_SCHEDULE = {
  id: 'roast-chicken-dinner',
  name: 'Roast Chicken Dinner',
  description: 'A classic Sunday roast with oven-constrained cooking steps.',
  timeConstraint: { endTime: '2026-03-01T19:00:00' },
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
      durationMins: 15,
      trackId: 'mains',
      dependencies: [],
      resourceNeeds: [],
    },
    {
      id: 'roast-chicken',
      title: 'Roast chicken',
      durationMins: 90,
      trackId: 'mains',
      dependencies: [{ stepId: 'prep-chicken', dependencyType: 'FinishToStart' }],
      resourceNeeds: [{ resourceId: 'oven', quantity: 1 }],
    },
    {
      id: 'prep-potatoes',
      title: 'Prep potatoes',
      durationMins: 20,
      trackId: 'sides',
      dependencies: [],
      resourceNeeds: [],
    },
    {
      id: 'roast-potatoes',
      title: 'Roast potatoes',
      durationMins: 45,
      trackId: 'sides',
      dependencies: [
        { stepId: 'prep-potatoes', dependencyType: 'FinishToStart' },
        { stepId: 'roast-chicken', dependencyType: 'FinishToStart' },
      ],
      resourceNeeds: [{ resourceId: 'oven', quantity: 1 }],
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
- timingPolicy values: "Asap" or "Alap" (optional, omit if not needed)
- dependencyType values: "FinishToStart", "StartToStart", "FinishToFinish", "StartToFinish"
- DO NOT reference stepIds or resourceIds that are not defined in your output

EXAMPLE (follow this structure exactly):
${JSON.stringify(EXAMPLE_SCHEDULE, null, 2)}

Output only valid JSON matching the schedule schema. No markdown, no explanation.`;
}

/**
 * Generate a ScheduleInput from a natural language description using an LLM.
 * Validates the result against the Zod schema AND referential integrity.
 * Throws immediately on invalid output (no retry).
 */
export async function generateScheduleFromText(
  description: string,
  model: LanguageModel,
): Promise<ScheduleInput> {
  let result: ScheduleInput;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gen = generateObject as (opts: any) => Promise<{ object: ScheduleInput }>;
    const { object } = await gen({
      model,
      schema: scheduleSchema,
      system: buildSystemPrompt(),
      prompt: description,
    });
    result = object;
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
