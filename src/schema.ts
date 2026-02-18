import { z } from 'zod';

export const dependencyTypeValues = ['FinishToStart', 'StartToStart', 'FinishToFinish', 'StartToFinish'] as const;
export const timingPolicyValues = ['Asap', 'Alap'] as const;
export const resourceKindValues = ['Equipment', 'People', 'Consumable'] as const;

const stepDependencySchema = z.object({
  stepId: z.string(),
  dependencyType: z.enum(dependencyTypeValues).default('FinishToStart'),
});

const resourceNeedSchema = z.object({
  resourceId: z.string(),
  quantity: z.number().int().positive(),
  minPeople: z.number().int().positive().optional(),
  maxPeople: z.number().int().positive().optional(),
});

const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  durationMins: z.number().int().positive(),
  dependencies: z.array(stepDependencySchema).default([]),
  trackId: z.string().optional(),
  timingPolicy: z.enum(timingPolicyValues).optional(),
  resourceNeeds: z.array(resourceNeedSchema).default([]),
});

const trackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const resourceSchema = z.object({
  id: z.string().min(1),
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
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(stepSchema).min(1, 'At least one step is required'),
  tracks: z.array(trackSchema).default([]),
  resources: z.array(resourceSchema).default([]),
  timeConstraint: timeConstraintSchema.optional(),
  defaultNumPeople: z.number().int().positive().optional(),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;
