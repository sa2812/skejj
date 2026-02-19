import { z } from 'zod';

export const dependencyTypeValues = ['FinishToStart', 'StartToStart', 'FinishToFinish', 'StartToFinish'] as const;
export const timingPolicyValues = ['Asap', 'Alap'] as const;
export const resourceKindValues = ['Equipment', 'People', 'Consumable'] as const;

const stepDependencySchema = z.object({
  stepId: z.coerce.string(),
  dependencyType: z.enum(dependencyTypeValues).default('FinishToStart'),
});

const resourceNeedSchema = z.object({
  resourceId: z.coerce.string(),
  quantity: z.number().int().positive(),
  minPeople: z.number().int().positive().optional(),
  maxPeople: z.number().int().positive().optional(),
});

const stepSchema = z.object({
  id: z.coerce.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  durationMins: z.number().int().positive(),
  dependencies: z.array(stepDependencySchema).default([]),
  trackId: z.string().optional(),
  timingPolicy: z.enum(timingPolicyValues).optional(),
  resourceNeeds: z.array(resourceNeedSchema).default([]),
});

const trackSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
});

const resourceSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
  kind: z.enum(resourceKindValues),
  capacity: z.number().int().positive(),
  roles: z.array(z.string()).default([]),
});

const timeConstraintSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export const scheduleSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(stepSchema).min(1, 'At least one step is required'),
  tracks: z.array(trackSchema).default([]),
  resources: z.array(resourceSchema).default([]),
  timeConstraint: timeConstraintSchema.optional(),
  defaultNumPeople: z.number().int().positive().optional(),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;

// ---------------------------------------------------------------------------
// AI-specific schemas for OpenAI strict mode
// ---------------------------------------------------------------------------
// OpenAI structured output (strict mode) requires every property in an object's
// `properties` to also appear in `required`. Zod's .default() and .optional()
// both cause the field to be excluded from `required` by the AI SDK's
// Zod-to-JSON-Schema converter. The solution is a parallel set of schemas that
// use .nullable() instead — the field is always present (satisfying `required`)
// but can carry null to mean "not applicable."
// The original scheduleSchema remains unchanged for file loading (skejj make/check).

const aiStepDependencySchema = z.object({
  stepId: z.string(),
  dependencyType: z.enum(dependencyTypeValues), // required, no default
});

const aiResourceNeedSchema = z.object({
  resourceId: z.string(),
  quantity: z.number().int().positive(),
  minPeople: z.number().int().positive().nullable(),
  maxPeople: z.number().int().positive().nullable(),
});

const aiStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  durationMins: z.number().int().positive(),
  dependencies: z.array(aiStepDependencySchema), // required, no default
  trackId: z.string().nullable(),
  timingPolicy: z.enum(timingPolicyValues).nullable(),
  resourceNeeds: z.array(aiResourceNeedSchema), // required, no default
});

const aiResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(resourceKindValues),
  capacity: z.number().int().positive(),
  roles: z.array(z.string()), // required, no default
});

const aiTimeConstraintSchema = z.object({
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
});

export const aiScheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  steps: z.array(aiStepSchema).min(1, 'At least one step is required'),
  tracks: z.array(trackSchema), // trackSchema has no optional fields — reuse it
  resources: z.array(aiResourceSchema), // required, no default
  timeConstraint: aiTimeConstraintSchema.nullable(),
  defaultNumPeople: z.number().int().positive().nullable(),
});

export type AiScheduleOutput = z.infer<typeof aiScheduleSchema>;

/**
 * Convert AI-generated output (all fields present, nulls for "not applicable")
 * into a ScheduleInput that the original scheduleSchema accepts.
 */
export function applyScheduleDefaults(raw: AiScheduleOutput): ScheduleInput {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? undefined,
    steps: raw.steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description ?? undefined,
      durationMins: step.durationMins,
      dependencies: (step.dependencies ?? []).map((dep) => ({
        stepId: dep.stepId,
        dependencyType: dep.dependencyType,
      })),
      trackId: step.trackId ?? undefined,
      timingPolicy: step.timingPolicy ?? undefined,
      resourceNeeds: (step.resourceNeeds ?? []).map((need) => ({
        resourceId: need.resourceId,
        quantity: need.quantity,
        minPeople: need.minPeople ?? undefined,
        maxPeople: need.maxPeople ?? undefined,
      })),
    })),
    tracks: raw.tracks ?? [],
    resources: (raw.resources ?? []).map((res) => ({
      id: res.id,
      name: res.name,
      kind: res.kind,
      capacity: res.capacity,
      roles: res.roles ?? [],
    })),
    timeConstraint:
      raw.timeConstraint === null
        ? undefined
        : {
            startTime: raw.timeConstraint.startTime ?? undefined,
            endTime: raw.timeConstraint.endTime ?? undefined,
          },
    defaultNumPeople: raw.defaultNumPeople ?? undefined,
  };
}
