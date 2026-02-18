/**
 * Referential integrity checker for ScheduleInput.
 * Validates that all stepId and resourceId references exist in the schedule.
 */

import type { ScheduleInput } from '../schema';

/**
 * Check referential integrity of a schedule.
 * Throws on the first error found with a message naming the bad reference.
 */
export function checkReferentialIntegrity(schedule: ScheduleInput): void {
  // Collect all step IDs and detect duplicates
  const stepIds = new Set<string>();
  for (const step of schedule.steps) {
    if (stepIds.has(step.id)) {
      throw new Error(`Duplicate step ID: "${step.id}"`);
    }
    stepIds.add(step.id);
  }

  // Collect all resource IDs and detect duplicates
  const resourceIds = new Set<string>();
  for (const resource of schedule.resources) {
    if (resourceIds.has(resource.id)) {
      throw new Error(`Duplicate resource ID: "${resource.id}"`);
    }
    resourceIds.add(resource.id);
  }

  // Check dependency references
  for (const step of schedule.steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep.stepId)) {
        throw new Error(
          `Step "${step.id}" references unknown dependency stepId "${dep.stepId}"`,
        );
      }
    }
  }

  // Check resource need references
  for (const step of schedule.steps) {
    for (const need of step.resourceNeeds) {
      if (!resourceIds.has(need.resourceId)) {
        throw new Error(
          `Step "${step.id}" references unknown resourceId "${need.resourceId}"`,
        );
      }
    }
  }
}
