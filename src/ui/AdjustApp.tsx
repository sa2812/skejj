import React, { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { TextInput, Select, MultiSelect } from '@inkjs/ui';
import * as fs from 'fs';
import * as path from 'path';
import type { ScheduleInput } from '../schema.js';
import { renderGantt, detectColorLevel } from '../renderer.js';
import { solve } from '../engine.js';
import type { SolvedScheduleResult } from '../engine.js';

// ---- helpers ----------------------------------------------------------------

function toKebab(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ---- screen state machine type ---------------------------------------------

type AdjustScreen =
  | { kind: 'main-menu' }
  | { kind: 'edit-step-field-select'; stepIndex: number }
  | { kind: 'edit-step-title'; stepIndex: number }
  | { kind: 'edit-step-duration'; stepIndex: number }
  | { kind: 'edit-step-timing-policy'; stepIndex: number }
  | { kind: 'edit-step-dependencies'; stepIndex: number }
  | { kind: 'edit-step-dependency-type'; stepIndex: number; depStepId: string; toggling: 'add' | 'change' }
  | { kind: 'edit-step-resource-needs'; stepIndex: number }
  | { kind: 'edit-step-resource-need-qty'; stepIndex: number; resourceId: string }
  | { kind: 'edit-step-description'; stepIndex: number }
  | { kind: 'edit-step-track'; stepIndex: number }
  | { kind: 'add-step-title' }
  | { kind: 'add-step-duration'; title: string }
  | { kind: 'remove-step' }
  | { kind: 'edit-resources' }
  | { kind: 'add-resource-name' }
  | { kind: 'add-resource-kind'; name: string }
  | { kind: 'add-resource-capacity'; name: string; resourceKind: 'Equipment' | 'People' | 'Consumable' }
  | { kind: 'edit-resource-select' }
  | { kind: 'edit-resource-field-select'; resourceIndex: number }
  | { kind: 'edit-resource-name'; resourceIndex: number }
  | { kind: 'edit-resource-kind'; resourceIndex: number }
  | { kind: 'edit-resource-capacity'; resourceIndex: number }
  | { kind: 'remove-resource-select' }
  | { kind: 'edit-time-constraint' }
  | { kind: 'edit-time-constraint-value'; constraintType: 'startTime' | 'endTime' }
  | { kind: 'exit-prompt' }
  | { kind: 'save-new-file' };

// ---- props -----------------------------------------------------------------

export interface AdjustAppProps {
  initialSchedule: ScheduleInput;
  initialSolved: SolvedScheduleResult;
  originalFile: string;
}

// ---- main component --------------------------------------------------------

export default function AdjustApp({ initialSchedule, initialSolved, originalFile }: AdjustAppProps) {
  const { exit } = useApp();

  const [screen, setScreen] = useState<AdjustScreen>({ kind: 'main-menu' });
  const [schedule, setSchedule] = useState<ScheduleInput>(initialSchedule);
  const [solved, setSolved] = useState<SolvedScheduleResult>(initialSolved);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // ---- re-solve helper -----------------------------------------------------

  const resolveSchedule = useCallback((updated: ScheduleInput) => {
    try {
      const result = solve(updated);
      setSolved(result);
      setSolveError(null);
    } catch (e) {
      setSolveError((e as Error).message ?? String(e));
    }
  }, []);

  const updateSchedule = useCallback((updated: ScheduleInput) => {
    setSchedule(updated);
    resolveSchedule(updated);
  }, [resolveSchedule]);

  // ---- gantt display -------------------------------------------------------

  const colorLevel = detectColorLevel();
  const ganttString = renderGantt(solved, schedule, {
    quiet: true,
    termWidth: process.stdout.columns ?? 80,
    colorLevel,
  });

  // ---- screen rendering ----------------------------------------------------

  // Main menu
  if (screen.kind === 'main-menu') {
    const stepOptions = schedule.steps.map((s, i) => ({
      label: `Step: ${s.title} (${s.durationMins}m)`,
      value: `step:${i}`,
    }));

    const menuOptions = [
      ...stepOptions,
      { label: '+ Add step', value: 'add-step' },
      ...(schedule.steps.length > 1 ? [{ label: '- Remove step', value: 'remove-step' }] : []),
      { label: 'Edit resources', value: 'edit-resources' },
      { label: 'Edit time constraint', value: 'edit-time-constraint' },
      { label: 'Exit', value: 'exit' },
    ];

    return (
      <Box flexDirection="column">
        <Text>{ganttString}</Text>
        {solveError && (
          <Text color="red">Solve error (showing last valid result): {solveError}</Text>
        )}
        {statusMsg && <Text color="green">{statusMsg}</Text>}
        <Text> </Text>
        <Text bold>What would you like to adjust?</Text>
        <Select
          options={menuOptions}
          onChange={(val) => {
            setInputError(null);
            setStatusMsg(null);
            if (val === 'add-step') {
              setScreen({ kind: 'add-step-title' });
            } else if (val === 'remove-step') {
              setScreen({ kind: 'remove-step' });
            } else if (val === 'edit-resources') {
              setScreen({ kind: 'edit-resources' });
            } else if (val === 'edit-time-constraint') {
              setScreen({ kind: 'edit-time-constraint' });
            } else if (val === 'exit') {
              setScreen({ kind: 'exit-prompt' });
            } else if (val.startsWith('step:')) {
              const idx = parseInt(val.split(':')[1], 10);
              setScreen({ kind: 'edit-step-field-select', stepIndex: idx });
            }
          }}
        />
      </Box>
    );
  }

  // Edit step: choose which field
  if (screen.kind === 'edit-step-field-select') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    if (!step) return <Box><Text color="red">Step not found</Text></Box>;

    const depSummary = step.dependencies.length > 0
      ? step.dependencies.map((d) => `${d.stepId}(${d.dependencyType})`).join(', ')
      : 'none';
    const rNeedsSummary = step.resourceNeeds.length > 0
      ? step.resourceNeeds.map((r) => `${r.resourceId}x${r.quantity}`).join(', ')
      : 'none';

    const fieldOptions = [
      { label: `title: "${step.title}"`, value: 'title' },
      { label: `durationMins: ${step.durationMins}`, value: 'duration' },
      { label: `timingPolicy: ${step.timingPolicy ?? 'Asap (default)'}`, value: 'timing-policy' },
      { label: `dependencies: [${depSummary}]`, value: 'dependencies' },
      { label: `resourceNeeds: [${rNeedsSummary}]`, value: 'resource-needs' },
      { label: `description: "${step.description ?? ''}"`, value: 'description' },
      { label: `trackId: "${step.trackId ?? ''}"`, value: 'track' },
      { label: '< Back to menu', value: 'back' },
    ];

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">Editing step: {step.title}</Text>
        <Text dimColor>Select a field to edit:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <Select
          options={fieldOptions}
          onChange={(val) => {
            setInputError(null);
            if (val === 'back') { setScreen({ kind: 'main-menu' }); return; }
            if (val === 'title') { setScreen({ kind: 'edit-step-title', stepIndex }); }
            else if (val === 'duration') { setScreen({ kind: 'edit-step-duration', stepIndex }); }
            else if (val === 'timing-policy') { setScreen({ kind: 'edit-step-timing-policy', stepIndex }); }
            else if (val === 'dependencies') { setScreen({ kind: 'edit-step-dependencies', stepIndex }); }
            else if (val === 'resource-needs') { setScreen({ kind: 'edit-step-resource-needs', stepIndex }); }
            else if (val === 'description') { setScreen({ kind: 'edit-step-description', stepIndex }); }
            else if (val === 'track') { setScreen({ kind: 'edit-step-track', stepIndex }); }
          }}
        />
      </Box>
    );
  }

  // Edit step title
  if (screen.kind === 'edit-step-title') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — title:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={step.title}
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Title cannot be empty'); return; }
            setInputError(null);
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex ? { ...s, title: trimmed } : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated title to "${trimmed}"`);
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step duration
  if (screen.kind === 'edit-step-duration') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — durationMins:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={String(step.durationMins)}
          onSubmit={(val) => {
            const trimmed = val.trim();
            const n = trimmed ? parseInt(trimmed, 10) : step.durationMins;
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer (minutes)'); return; }
            setInputError(null);
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex ? { ...s, durationMins: n } : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated durationMins to ${n}`);
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step timing policy
  if (screen.kind === 'edit-step-timing-policy') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — timingPolicy (current: {step.timingPolicy ?? 'Asap'}):</Text>
        <Select
          options={[
            { label: 'Asap — schedule as early as possible', value: 'Asap' },
            { label: 'Alap — schedule as late as possible', value: 'Alap' },
            { label: '< Back', value: 'back' },
          ]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'edit-step-field-select', stepIndex }); return; }
            const policy = val as 'Asap' | 'Alap';
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex ? { ...s, timingPolicy: policy } : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated timingPolicy to ${policy}`);
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step dependencies: select which other steps to depend on
  if (screen.kind === 'edit-step-dependencies') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    const otherSteps = schedule.steps.filter((_, i) => i !== stepIndex);

    if (otherSteps.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>No other steps to depend on.</Text>
          <Text dimColor>Add more steps first. Press enter to go back.</Text>
          <TextInput placeholder="" onSubmit={() => setScreen({ kind: 'edit-step-field-select', stepIndex })} />
        </Box>
      );
    }

    const currentDepIds = step.dependencies.map((d) => d.stepId);
    const depOptions = otherSteps.map((s) => ({ label: `${s.title} (${s.id})`, value: s.id }));

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — dependencies:</Text>
        <Text dimColor>Space to toggle, Enter to confirm. After confirming, choose dependency type for new deps.</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <MultiSelect
          options={depOptions}
          defaultValue={currentDepIds}
          onSubmit={(selectedIds) => {
            setInputError(null);
            // Find newly added deps that need a type selection
            const added = selectedIds.filter((id) => !currentDepIds.includes(id));
            const removed = currentDepIds.filter((id) => !selectedIds.includes(id));

            // Build new dependencies list:
            // - keep existing deps that are still selected (preserve their type)
            // - add new deps with FinishToStart default (then prompt for type if desired)
            const existingKept = step.dependencies.filter((d) => selectedIds.includes(d.stepId));
            const newDeps = added.map((id) => ({ stepId: id, dependencyType: 'FinishToStart' as const }));
            const allDeps = [...existingKept, ...newDeps];

            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex ? { ...s, dependencies: allDeps } : s
              ),
            };
            updateSchedule(updated);

            const changes = [];
            if (added.length > 0) changes.push(`added: ${added.join(', ')}`);
            if (removed.length > 0) changes.push(`removed: ${removed.join(', ')}`);
            setStatusMsg(changes.length > 0 ? `Dependencies updated (${changes.join('; ')})` : 'No changes');
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step resource needs: select which resources and quantities
  if (screen.kind === 'edit-step-resource-needs') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];

    if (schedule.resources.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>No resources defined.</Text>
          <Text dimColor>Add resources first via "Edit resources". Press enter to go back.</Text>
          <TextInput placeholder="" onSubmit={() => setScreen({ kind: 'edit-step-field-select', stepIndex })} />
        </Box>
      );
    }

    const currentResourceIds = step.resourceNeeds.map((r) => r.resourceId);
    const resourceOptions = schedule.resources.map((r) => ({
      label: `${r.name} (${r.kind}, cap: ${r.capacity})`,
      value: r.id,
    }));

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — resourceNeeds:</Text>
        <Text dimColor>Space to toggle resources. Enter to confirm. You'll set quantities for newly added ones.</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <MultiSelect
          options={resourceOptions}
          defaultValue={currentResourceIds}
          onSubmit={(selectedIds) => {
            setInputError(null);
            const added = selectedIds.filter((id) => !currentResourceIds.includes(id));
            const removed = currentResourceIds.filter((id) => !selectedIds.includes(id));

            if (removed.length > 0) {
              // Remove un-selected resources immediately
              const updatedNeeds = step.resourceNeeds.filter((r) => selectedIds.includes(r.resourceId));
              const updated: ScheduleInput = {
                ...schedule,
                steps: schedule.steps.map((s, i) =>
                  i === stepIndex ? { ...s, resourceNeeds: updatedNeeds } : s
                ),
              };
              updateSchedule(updated);
            }

            if (added.length > 0) {
              // Set quantity for first new resource
              setScreen({ kind: 'edit-step-resource-need-qty', stepIndex, resourceId: added[0] });
              return;
            }

            const changes = [];
            if (added.length > 0) changes.push(`added: ${added.join(', ')}`);
            if (removed.length > 0) changes.push(`removed: ${removed.join(', ')}`);
            setStatusMsg(changes.length > 0 ? `Resource needs updated` : 'No changes');
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Set quantity for newly added resource need
  if (screen.kind === 'edit-step-resource-need-qty') {
    const { stepIndex, resourceId } = screen;
    const step = schedule.steps[stepIndex];
    const resource = schedule.resources.find((r) => r.id === resourceId);
    const existingNeed = step.resourceNeeds.find((r) => r.resourceId === resourceId);

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>How many "{resource?.name ?? resourceId}" does "{step.title}" need?</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={existingNeed ? String(existingNeed.quantity) : '1'}
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer'); return; }
            setInputError(null);

            const updatedNeeds = [
              ...step.resourceNeeds.filter((r) => r.resourceId !== resourceId),
              { resourceId, quantity: n },
            ];
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex ? { ...s, resourceNeeds: updatedNeeds } : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Set ${resource?.name ?? resourceId} quantity to ${n}`);
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step description
  if (screen.kind === 'edit-step-description') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — description (empty to clear):</Text>
        <TextInput
          defaultValue={step.description ?? ''}
          onSubmit={(val) => {
            const trimmed = val.trim();
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex
                  ? { ...s, description: trimmed || undefined }
                  : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(trimmed ? `Updated description` : 'Cleared description');
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Edit step trackId
  if (screen.kind === 'edit-step-track') {
    const { stepIndex } = screen;
    const step = schedule.steps[stepIndex];

    const trackOptions = [
      { label: '(none — clear trackId)', value: '' },
      ...schedule.tracks.map((t) => ({ label: `${t.name} (${t.id})`, value: t.id })),
    ];

    if (schedule.tracks.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Edit "{step.title}" — trackId (no tracks defined, enter value manually or blank to clear):</Text>
          <TextInput
            defaultValue={step.trackId ?? ''}
            onSubmit={(val) => {
              const trimmed = val.trim();
              const updated: ScheduleInput = {
                ...schedule,
                steps: schedule.steps.map((s, i) =>
                  i === stepIndex
                    ? { ...s, trackId: trimmed || undefined }
                    : s
                ),
              };
              updateSchedule(updated);
              setStatusMsg(trimmed ? `Set trackId to "${trimmed}"` : 'Cleared trackId');
              setScreen({ kind: 'edit-step-field-select', stepIndex });
            }}
          />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{step.title}" — trackId (current: {step.trackId ?? 'none'}):</Text>
        <Select
          options={trackOptions}
          onChange={(val) => {
            const updated: ScheduleInput = {
              ...schedule,
              steps: schedule.steps.map((s, i) =>
                i === stepIndex
                  ? { ...s, trackId: val || undefined }
                  : s
              ),
            };
            updateSchedule(updated);
            setStatusMsg(val ? `Set trackId to "${val}"` : 'Cleared trackId');
            setScreen({ kind: 'edit-step-field-select', stepIndex });
          }}
        />
      </Box>
    );
  }

  // Add step: title
  if (screen.kind === 'add-step-title') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New step — title:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. Preheat Oven"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Title cannot be empty'); return; }
            setInputError(null);
            setScreen({ kind: 'add-step-duration', title: trimmed });
          }}
        />
      </Box>
    );
  }

  // Add step: duration
  if (screen.kind === 'add-step-duration') {
    const { title } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New step "{title}" — durationMins:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. 30"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer (minutes)'); return; }
            setInputError(null);

            const existingIds = schedule.steps.map((s) => s.id);
            const newId = uniqueId(toKebab(title), existingIds);
            const newStep = {
              id: newId,
              title,
              durationMins: n,
              dependencies: [] as Array<{ stepId: string; dependencyType: 'FinishToStart' | 'StartToStart' | 'FinishToFinish' | 'StartToFinish' }>,
              resourceNeeds: [] as Array<{ resourceId: string; quantity: number }>,
            };
            const updated: ScheduleInput = {
              ...schedule,
              steps: [...schedule.steps, newStep],
            };
            updateSchedule(updated);
            setStatusMsg(`Added step "${title}"`);
            setScreen({ kind: 'main-menu' });
          }}
        />
      </Box>
    );
  }

  // Remove step
  if (screen.kind === 'remove-step') {
    const stepOptions = schedule.steps.map((s, i) => ({
      label: `${s.title} (${s.durationMins}m)`,
      value: String(i),
    }));

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Remove which step?</Text>
        <Select
          options={[...stepOptions, { label: '< Back', value: 'back' }]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'main-menu' }); return; }
            const idx = parseInt(val, 10);
            const removedId = schedule.steps[idx].id;
            const updatedSteps = schedule.steps
              .filter((_, i) => i !== idx)
              .map((s) => ({
                ...s,
                dependencies: s.dependencies.filter((d) => d.stepId !== removedId),
              }));
            const updated: ScheduleInput = {
              ...schedule,
              steps: updatedSteps,
            };
            updateSchedule(updated);
            setStatusMsg(`Removed step "${schedule.steps[idx].title}"`);
            setScreen({ kind: 'main-menu' });
          }}
        />
      </Box>
    );
  }

  // Edit resources hub
  if (screen.kind === 'edit-resources') {
    const resourceSummary = schedule.resources.length > 0
      ? schedule.resources.map((r) => `${r.name}(${r.kind})`).join(', ')
      : 'none';

    const menuOptions = [
      { label: '+ Add resource', value: 'add' },
      ...(schedule.resources.length > 0 ? [{ label: 'Edit a resource', value: 'edit' }] : []),
      ...(schedule.resources.length > 0 ? [{ label: '- Remove a resource', value: 'remove' }] : []),
      { label: '< Back to main menu', value: 'back' },
    ];

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Resources: {resourceSummary}</Text>
        {statusMsg && <Text color="green">{statusMsg}</Text>}
        <Select
          options={menuOptions}
          onChange={(val) => {
            setStatusMsg(null);
            if (val === 'back') { setScreen({ kind: 'main-menu' }); }
            else if (val === 'add') { setScreen({ kind: 'add-resource-name' }); }
            else if (val === 'edit') { setScreen({ kind: 'edit-resource-select' }); }
            else if (val === 'remove') { setScreen({ kind: 'remove-resource-select' }); }
          }}
        />
      </Box>
    );
  }

  // Add resource: name
  if (screen.kind === 'add-resource-name') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New resource — name:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. Oven, Kitchen Staff"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Name cannot be empty'); return; }
            setInputError(null);
            setScreen({ kind: 'add-resource-kind', name: trimmed });
          }}
        />
      </Box>
    );
  }

  // Add resource: kind
  if (screen.kind === 'add-resource-kind') {
    const { name } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Resource "{name}" — kind:</Text>
        <Select
          options={[
            { label: 'Equipment (oven, machine, room)', value: 'Equipment' },
            { label: 'People (staff, helpers)', value: 'People' },
            { label: 'Consumable (ingredients, materials)', value: 'Consumable' },
          ]}
          onChange={(val: string) => {
            setScreen({
              kind: 'add-resource-capacity',
              name,
              resourceKind: val as 'Equipment' | 'People' | 'Consumable',
            });
          }}
        />
      </Box>
    );
  }

  // Add resource: capacity
  if (screen.kind === 'add-resource-capacity') {
    const { name, resourceKind } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Resource "{name}" — capacity (units available simultaneously):</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. 1"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer'); return; }
            setInputError(null);

            const existingIds = schedule.resources.map((r) => r.id);
            const newId = uniqueId(toKebab(name), existingIds);
            const updated: ScheduleInput = {
              ...schedule,
              resources: [
                ...schedule.resources,
                { id: newId, name, kind: resourceKind, capacity: n, roles: [] },
              ],
            };
            updateSchedule(updated);
            setStatusMsg(`Added resource "${name}"`);
            setScreen({ kind: 'edit-resources' });
          }}
        />
      </Box>
    );
  }

  // Edit resource: select which one
  if (screen.kind === 'edit-resource-select') {
    const resourceOptions = schedule.resources.map((r, i) => ({
      label: `${r.name} (${r.kind}, cap: ${r.capacity})`,
      value: String(i),
    }));

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit which resource?</Text>
        <Select
          options={[...resourceOptions, { label: '< Back', value: 'back' }]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'edit-resources' }); return; }
            setScreen({ kind: 'edit-resource-field-select', resourceIndex: parseInt(val, 10) });
          }}
        />
      </Box>
    );
  }

  // Edit resource: choose which field
  if (screen.kind === 'edit-resource-field-select') {
    const { resourceIndex } = screen;
    const resource = schedule.resources[resourceIndex];
    if (!resource) return <Box><Text color="red">Resource not found</Text></Box>;

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">Editing resource: {resource.name}</Text>
        <Select
          options={[
            { label: `name: "${resource.name}"`, value: 'name' },
            { label: `kind: ${resource.kind}`, value: 'kind' },
            { label: `capacity: ${resource.capacity}`, value: 'capacity' },
            { label: '< Back', value: 'back' },
          ]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'edit-resource-select' }); return; }
            if (val === 'name') { setScreen({ kind: 'edit-resource-name', resourceIndex }); }
            else if (val === 'kind') { setScreen({ kind: 'edit-resource-kind', resourceIndex }); }
            else if (val === 'capacity') { setScreen({ kind: 'edit-resource-capacity', resourceIndex }); }
          }}
        />
      </Box>
    );
  }

  // Edit resource name
  if (screen.kind === 'edit-resource-name') {
    const { resourceIndex } = screen;
    const resource = schedule.resources[resourceIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{resource.name}" — name:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={resource.name}
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Name cannot be empty'); return; }
            setInputError(null);
            const updated: ScheduleInput = {
              ...schedule,
              resources: schedule.resources.map((r, i) =>
                i === resourceIndex ? { ...r, name: trimmed } : r
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated resource name to "${trimmed}"`);
            setScreen({ kind: 'edit-resource-field-select', resourceIndex });
          }}
        />
      </Box>
    );
  }

  // Edit resource kind
  if (screen.kind === 'edit-resource-kind') {
    const { resourceIndex } = screen;
    const resource = schedule.resources[resourceIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{resource.name}" — kind (current: {resource.kind}):</Text>
        <Select
          options={[
            { label: 'Equipment (oven, machine, room)', value: 'Equipment' },
            { label: 'People (staff, helpers)', value: 'People' },
            { label: 'Consumable (ingredients, materials)', value: 'Consumable' },
            { label: '< Back', value: 'back' },
          ]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'edit-resource-field-select', resourceIndex }); return; }
            const updated: ScheduleInput = {
              ...schedule,
              resources: schedule.resources.map((r, i) =>
                i === resourceIndex
                  ? { ...r, kind: val as 'Equipment' | 'People' | 'Consumable' }
                  : r
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated kind to ${val}`);
            setScreen({ kind: 'edit-resource-field-select', resourceIndex });
          }}
        />
      </Box>
    );
  }

  // Edit resource capacity
  if (screen.kind === 'edit-resource-capacity') {
    const { resourceIndex } = screen;
    const resource = schedule.resources[resourceIndex];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit "{resource.name}" — capacity:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={String(resource.capacity)}
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer'); return; }
            setInputError(null);
            const updated: ScheduleInput = {
              ...schedule,
              resources: schedule.resources.map((r, i) =>
                i === resourceIndex ? { ...r, capacity: n } : r
              ),
            };
            updateSchedule(updated);
            setStatusMsg(`Updated capacity to ${n}`);
            setScreen({ kind: 'edit-resource-field-select', resourceIndex });
          }}
        />
      </Box>
    );
  }

  // Remove resource
  if (screen.kind === 'remove-resource-select') {
    const resourceOptions = schedule.resources.map((r, i) => ({
      label: `${r.name} (${r.kind}, cap: ${r.capacity})`,
      value: String(i),
    }));

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Remove which resource?</Text>
        <Text color="yellow">Warning: this will also remove all resourceNeeds referencing it.</Text>
        <Select
          options={[...resourceOptions, { label: '< Back', value: 'back' }]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'edit-resources' }); return; }
            const idx = parseInt(val, 10);
            const removedId = schedule.resources[idx].id;
            const removedName = schedule.resources[idx].name;

            // Remove resource and clean up resourceNeeds across all steps
            const updatedSteps = schedule.steps.map((s) => ({
              ...s,
              resourceNeeds: s.resourceNeeds.filter((r) => r.resourceId !== removedId),
            }));
            const updated: ScheduleInput = {
              ...schedule,
              resources: schedule.resources.filter((_, i) => i !== idx),
              steps: updatedSteps,
            };
            updateSchedule(updated);
            setStatusMsg(`Removed resource "${removedName}"`);
            setScreen({ kind: 'edit-resources' });
          }}
        />
      </Box>
    );
  }

  // Edit time constraint hub
  if (screen.kind === 'edit-time-constraint') {
    const tc = schedule.timeConstraint;
    const current = tc?.startTime
      ? `Start: ${tc.startTime}`
      : tc?.endTime
        ? `End deadline: ${tc.endTime}`
        : 'None';

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Time constraint (current: {current}):</Text>
        <Select
          options={[
            { label: 'Set start time (schedule from a specific time)', value: 'startTime' },
            { label: 'Set end deadline (must finish by a specific time)', value: 'endTime' },
            { label: 'Clear constraint (use relative offsets)', value: 'clear' },
            { label: '< Back', value: 'back' },
          ]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'main-menu' }); return; }
            if (val === 'clear') {
              const updated: ScheduleInput = { ...schedule };
              delete updated.timeConstraint;
              updateSchedule(updated);
              setStatusMsg('Cleared time constraint');
              setScreen({ kind: 'main-menu' });
              return;
            }
            setScreen({ kind: 'edit-time-constraint-value', constraintType: val as 'startTime' | 'endTime' });
          }}
        />
      </Box>
    );
  }

  // Edit time constraint value
  if (screen.kind === 'edit-time-constraint-value') {
    const { constraintType } = screen;
    const label = constraintType === 'startTime' ? 'Start time' : 'End deadline';
    const existing = schedule.timeConstraint?.[constraintType] ?? '';

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{label} (ISO 8601, e.g. 2026-02-18T17:00:00):</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={existing}
          placeholder="2026-02-18T17:00:00"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Time value cannot be empty'); return; }
            setInputError(null);
            const updated: ScheduleInput = {
              ...schedule,
              timeConstraint: constraintType === 'startTime'
                ? { startTime: trimmed }
                : { endTime: trimmed },
            };
            updateSchedule(updated);
            setStatusMsg(`Set ${label} to ${trimmed}`);
            setScreen({ kind: 'main-menu' });
          }}
        />
      </Box>
    );
  }

  // Exit prompt: overwrite / new file / discard
  if (screen.kind === 'exit-prompt') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Save changes?</Text>
        <Select
          options={[
            { label: `Overwrite ${originalFile}`, value: 'overwrite' },
            { label: 'Save to new file', value: 'new-file' },
            { label: 'Discard changes', value: 'discard' },
          ]}
          onChange={(val) => {
            if (val === 'discard') {
              exit();
              return;
            }
            if (val === 'overwrite') {
              try {
                fs.writeFileSync(path.resolve(originalFile), JSON.stringify(schedule, null, 2));
                exit();
              } catch (e) {
                setInputError(`Failed to write file: ${(e as Error).message}`);
              }
              return;
            }
            if (val === 'new-file') {
              setScreen({ kind: 'save-new-file' });
            }
          }}
        />
        {inputError && <Text color="red">{inputError}</Text>}
      </Box>
    );
  }

  // Save to new file: TextInput for filename
  if (screen.kind === 'save-new-file') {
    const suggested = path.basename(originalFile, path.extname(originalFile)) + '-adjusted.json';
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Save to new file:</Text>
        <Text dimColor>Default: {suggested}</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={suggested}
          onSubmit={(val) => {
            const trimmed = val.trim() || suggested;
            try {
              const outPath = path.resolve(trimmed);
              fs.writeFileSync(outPath, JSON.stringify(schedule, null, 2));
              exit();
            } catch (e) {
              setInputError(`Failed to write file: ${(e as Error).message}`);
            }
          }}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Text color="red">Unknown screen state</Text>
    </Box>
  );
}
