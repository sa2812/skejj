import React, { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import { TextInput, Select, ConfirmInput, MultiSelect } from '@inkjs/ui';
import * as fs from 'fs';
import * as path from 'path';
import type { ScheduleInput } from '../schema.js';

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

// ---- draft types ------------------------------------------------------------

type StepDraft = {
  id: string;
  title: string;
  durationMins: number;
  dependencies: Array<{ stepId: string; dependencyType: 'FinishToStart' }>;
};

type ResourceDraft = {
  id: string;
  name: string;
  kind: 'Equipment' | 'People' | 'Consumable';
  capacity: number;
};

type ResourceNeed = { stepId: string; resourceId: string; quantity: number };

// ---- wizard screen state machine type --------------------------------------

type WizardScreen =
  | { kind: 'schedule-name' }
  | { kind: 'step-list' }
  | { kind: 'add-step-title' }
  | { kind: 'add-step-duration'; title: string }
  | { kind: 'add-step-deps'; title: string; durationMins: number }
  | { kind: 'edit-step-select' }
  | { kind: 'edit-step-title'; index: number }
  | { kind: 'edit-step-duration'; index: number; title: string }
  | { kind: 'edit-step-deps'; index: number; title: string; durationMins: number }
  | { kind: 'remove-step-select' }
  | { kind: 'resources-prompt' }
  | { kind: 'add-resource-name' }
  | { kind: 'add-resource-kind'; name: string }
  | { kind: 'add-resource-capacity'; name: string; resourceKind: 'Equipment' | 'People' | 'Consumable' }
  | { kind: 'more-resources' }
  | { kind: 'resource-needs-step'; stepIndex: number; resourceIdx: number }
  | { kind: 'resource-needs-qty'; stepIndex: number; resourceIdx: number }
  | { kind: 'time-anchor' }
  | { kind: 'time-anchor-value'; anchor: 'start' | 'end' }
  | { kind: 'filename' }
  | { kind: 'filename-overwrite'; filename: string }
  | { kind: 'confirm'; filename: string };

// ---- main component --------------------------------------------------------

export interface WizardAppProps {
  onComplete: (schedule: ScheduleInput, filename: string) => void;
}

export default function WizardApp({ onComplete }: WizardAppProps) {
  const { exit } = useApp();

  const [screen, setScreen] = useState<WizardScreen>({ kind: 'schedule-name' });
  const [scheduleName, setScheduleName] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [resources, setResources] = useState<ResourceDraft[]>([]);
  const [resourceNeeds, setResourceNeeds] = useState<ResourceNeed[]>([]);
  const [timeAnchor, setTimeAnchor] = useState<{ startTime?: string; endTime?: string } | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  // advance through resource-needs matrix: all steps x all resources
  const advanceResourceNeeds = useCallback(
    (stepIndex: number, resourceIdx: number, currentSteps: StepDraft[], currentResources: ResourceDraft[]) => {
      const nextStepIdx = stepIndex + 1;
      if (nextStepIdx < currentSteps.length) {
        setScreen({ kind: 'resource-needs-step', stepIndex: nextStepIdx, resourceIdx });
        return;
      }
      const nextResourceIdx = resourceIdx + 1;
      if (nextResourceIdx < currentResources.length) {
        setScreen({ kind: 'resource-needs-step', stepIndex: 0, resourceIdx: nextResourceIdx });
        return;
      }
      setScreen({ kind: 'time-anchor' });
    },
    []
  );

  function buildSchedule(): ScheduleInput {
    const schedId = toKebab(scheduleName) || 'schedule';
    const builtSteps = steps.map((s) => ({
      id: s.id,
      title: s.title,
      durationMins: s.durationMins,
      dependencies: s.dependencies,
      resourceNeeds: resourceNeeds
        .filter((rn) => rn.stepId === s.id)
        .map((rn) => ({ resourceId: rn.resourceId, quantity: rn.quantity })),
    }));

    return {
      id: schedId,
      name: scheduleName,
      steps: builtSteps,
      tracks: [],
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        roles: [],
        capacity: r.capacity,
      })),
      ...(timeAnchor ? { timeConstraint: timeAnchor } : {}),
    };
  }

  const stepOptions = steps.map((s, i) => ({
    label: `${i + 1}. ${s.title} (${s.durationMins}m)`,
    value: String(i),
  }));

  // ---- screen rendering ----------------------------------------------------

  if (screen.kind === 'schedule-name') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="green">skejj new — Create a schedule</Text>
        <Text>Schedule name:</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. Roast Chicken Dinner"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Name cannot be empty'); return; }
            setInputError(null);
            setScheduleName(trimmed);
            setScreen({ kind: 'step-list' });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'step-list') {
    const menuOptions = [
      { label: '+ Add a step', value: 'add' },
      ...(steps.length > 0 ? [{ label: 'Edit a step', value: 'edit' }] : []),
      ...(steps.length > 0 ? [{ label: 'Remove a step', value: 'remove' }] : []),
      ...(steps.length > 0 ? [{ label: 'Done with steps ->', value: 'done' }] : []),
    ];

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{scheduleName}</Text>
        {steps.length === 0 ? (
          <Text dimColor>No steps yet — add at least one.</Text>
        ) : (
          <Box flexDirection="column">
            {steps.map((s, i) => (
              <Text key={s.id}>
                {'  '}{i + 1}. <Text bold>{s.title}</Text>
                <Text dimColor> ({s.durationMins}m)</Text>
                {s.dependencies.length > 0 && (
                  <Text dimColor> after: {s.dependencies.map((d) => d.stepId).join(', ')}</Text>
                )}
              </Text>
            ))}
          </Box>
        )}
        <Select options={menuOptions} onChange={(val) => {
          if (val === 'add') { setScreen({ kind: 'add-step-title' }); return; }
          if (val === 'edit') { setScreen({ kind: 'edit-step-select' }); return; }
          if (val === 'remove') { setScreen({ kind: 'remove-step-select' }); return; }
          if (val === 'done') { setScreen({ kind: 'resources-prompt' }); return; }
        }} />
      </Box>
    );
  }

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

  if (screen.kind === 'add-step-duration') {
    const { title } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New step "{title}" — duration (minutes):</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. 30"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer (minutes)'); return; }
            setInputError(null);
            setScreen({ kind: 'add-step-deps', title, durationMins: n });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'add-step-deps') {
    const { title, durationMins } = screen;
    const depOptions = steps.map((s) => ({ label: s.title, value: s.id }));

    const commitStep = (selectedIds: string[]) => {
      const existingIds = steps.map((s) => s.id);
      const newId = uniqueId(toKebab(title), existingIds);
      const newStep: StepDraft = {
        id: newId,
        title,
        durationMins,
        dependencies: selectedIds.map((sid) => ({
          stepId: sid,
          dependencyType: 'FinishToStart' as const,
        })),
      };
      setSteps((prev) => [...prev, newStep]);
      setScreen({ kind: 'step-list' });
    };

    if (depOptions.length === 0) {
      // First step — no dependencies possible; commit immediately via effect-like trick
      // Use a one-time onClick workaround: render a prompt to press enter
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>New step "{title}" — no prior steps to depend on.</Text>
          <Text dimColor>Press enter to add step</Text>
          <TextInput
            placeholder=""
            onSubmit={() => commitStep([])}
          />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>New step "{title}" — dependencies:</Text>
        <Text dimColor>Space to toggle, Enter to confirm (none = no dependencies)</Text>
        <MultiSelect
          options={depOptions}
          onSubmit={(selectedValues) => commitStep(selectedValues)}
        />
      </Box>
    );
  }

  if (screen.kind === 'edit-step-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit which step?</Text>
        <Select
          options={[...stepOptions, { label: '< Back', value: 'back' }]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'step-list' }); return; }
            setScreen({ kind: 'edit-step-title', index: parseInt(val, 10) });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'edit-step-title') {
    const { index } = screen;
    const step = steps[index];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit step {index + 1} — title (enter to keep current):</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={step.title}
          onSubmit={(val) => {
            const trimmed = val.trim() || step.title;
            setInputError(null);
            setScreen({ kind: 'edit-step-duration', index, title: trimmed });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'edit-step-duration') {
    const { index, title } = screen;
    const step = steps[index];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit step "{title}" — duration (enter to keep {step.durationMins}m):</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={String(step.durationMins)}
          onSubmit={(val) => {
            const trimmed = val.trim();
            const n = trimmed ? parseInt(trimmed, 10) : step.durationMins;
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer'); return; }
            setInputError(null);
            setScreen({ kind: 'edit-step-deps', index, title, durationMins: n });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'edit-step-deps') {
    const { index, title, durationMins } = screen;
    const step = steps[index];
    const otherSteps = steps.filter((_, i) => i !== index);
    const depOptions = otherSteps.map((s) => ({ label: s.title, value: s.id }));
    const currentDepIds = step.dependencies
      .map((d) => d.stepId)
      .filter((id) => depOptions.some((o) => o.value === id));

    const commitEdit = (selectedIds: string[]) => {
      const existingIds = steps.filter((_, i) => i !== index).map((s) => s.id);
      const newId =
        title !== step.title ? uniqueId(toKebab(title), existingIds) : step.id;

      setSteps((prev) => {
        const updated = prev.map((s, i) => {
          if (i === index) {
            return {
              id: newId,
              title,
              durationMins,
              dependencies: selectedIds.map((sid) => ({
                stepId: sid,
                dependencyType: 'FinishToStart' as const,
              })),
            };
          }
          // Update references to renamed step in other steps' deps
          return {
            ...s,
            dependencies: s.dependencies.map((d) =>
              d.stepId === step.id ? { ...d, stepId: newId } : d
            ),
          };
        });
        return updated;
      });
      setScreen({ kind: 'step-list' });
    };

    if (depOptions.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Edit step "{title}" — no other steps to depend on.</Text>
          <Text dimColor>Press enter to save</Text>
          <TextInput placeholder="" onSubmit={() => commitEdit([])} />
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Edit step "{title}" — dependencies:</Text>
        <Text dimColor>Space to toggle, Enter to confirm</Text>
        <MultiSelect
          options={depOptions}
          defaultValue={currentDepIds}
          onSubmit={(selectedValues) => commitEdit(selectedValues)}
        />
      </Box>
    );
  }

  if (screen.kind === 'remove-step-select') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Remove which step?</Text>
        <Select
          options={[...stepOptions, { label: '< Back', value: 'back' }]}
          onChange={(val) => {
            if (val === 'back') { setScreen({ kind: 'step-list' }); return; }
            const idx = parseInt(val, 10);
            const removedId = steps[idx].id;
            setSteps((prev) => {
              const filtered = prev.filter((_, i) => i !== idx);
              return filtered.map((s) => ({
                ...s,
                dependencies: s.dependencies.filter((d) => d.stepId !== removedId),
              }));
            });
            setResourceNeeds((prev) => prev.filter((rn) => rn.stepId !== removedId));
            setScreen({ kind: 'step-list' });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'resources-prompt') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Do you need resources (equipment, people, materials)?</Text>
        <Text dimColor>y = yes, n = no (or press enter for no)</Text>
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={() => setScreen({ kind: 'add-resource-name' })}
          onCancel={() => setScreen({ kind: 'time-anchor' })}
        />
      </Box>
    );
  }

  if (screen.kind === 'add-resource-name') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Resource name:</Text>
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

  if (screen.kind === 'add-resource-kind') {
    const { name } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Resource "{name}" — type:</Text>
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

  if (screen.kind === 'add-resource-capacity') {
    const { name, resourceKind: kind } = screen;
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
            const existingIds = resources.map((r) => r.id);
            const newId = uniqueId(toKebab(name), existingIds);
            setResources((prev) => [...prev, { id: newId, name, kind, capacity: n }]);
            setScreen({ kind: 'more-resources' });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'more-resources') {
    const lastResource = resources[resources.length - 1];
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="green">Added resource: {lastResource?.name}</Text>
        <Text bold>Add another resource?</Text>
        <Text dimColor>y = yes, n = no</Text>
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={() => setScreen({ kind: 'add-resource-name' })}
          onCancel={() => {
            if (steps.length > 0 && resources.length > 0) {
              // Use the updated resources array (lastResource was just added)
              setScreen({ kind: 'resource-needs-step', stepIndex: 0, resourceIdx: 0 });
            } else {
              setScreen({ kind: 'time-anchor' });
            }
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'resource-needs-step') {
    const { stepIndex, resourceIdx } = screen;
    const step = steps[stepIndex];
    const resource = resources[resourceIdx];

    if (!step || !resource) {
      // Guard: if somehow out of bounds, proceed to time-anchor
      setScreen({ kind: 'time-anchor' });
      return <Box><Text>...</Text></Box>;
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Does "{step.title}" need "{resource.name}"?</Text>
        <Text dimColor>y = yes, n = no</Text>
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={() => setScreen({ kind: 'resource-needs-qty', stepIndex, resourceIdx })}
          onCancel={() => advanceResourceNeeds(stepIndex, resourceIdx, steps, resources)}
        />
      </Box>
    );
  }

  if (screen.kind === 'resource-needs-qty') {
    const { stepIndex, resourceIdx } = screen;
    const step = steps[stepIndex];
    const resource = resources[resourceIdx];
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>How many "{resource.name}" does "{step.title}" need?</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="e.g. 1"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { setInputError('Enter a positive integer'); return; }
            setInputError(null);
            setResourceNeeds((prev) => [
              ...prev.filter((rn) => !(rn.stepId === step.id && rn.resourceId === resource.id)),
              { stepId: step.id, resourceId: resource.id, quantity: n },
            ]);
            advanceResourceNeeds(stepIndex, resourceIdx, steps, resources);
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'time-anchor') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Scheduling anchor:</Text>
        <Select
          options={[
            { label: 'No time constraint (use relative offsets)', value: 'none' },
            { label: 'Start time — schedule starts at a specific time', value: 'start' },
            { label: 'End deadline — must finish by a specific time', value: 'end' },
          ]}
          onChange={(val) => {
            if (val === 'none') {
              setTimeAnchor(null);
              setScreen({ kind: 'filename' });
            } else {
              setScreen({ kind: 'time-anchor-value', anchor: val as 'start' | 'end' });
            }
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'time-anchor-value') {
    const { anchor } = screen;
    const label = anchor === 'start' ? 'Start time' : 'End deadline';
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{label} (ISO 8601):</Text>
        <Text dimColor>Example: 2026-02-18T17:00:00</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          placeholder="2026-02-18T17:00:00"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { setInputError('Time value cannot be empty'); return; }
            setInputError(null);
            setTimeAnchor(anchor === 'start' ? { startTime: trimmed } : { endTime: trimmed });
            setScreen({ kind: 'filename' });
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'filename') {
    const suggested = (toKebab(scheduleName) || 'schedule') + '.json';
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Output filename:</Text>
        <Text dimColor>Default: {suggested}</Text>
        {inputError && <Text color="red">{inputError}</Text>}
        <TextInput
          defaultValue={suggested}
          onSubmit={(val) => {
            const trimmed = val.trim() || suggested;
            setInputError(null);
            const fullPath = path.resolve(process.cwd(), trimmed);
            if (fs.existsSync(fullPath)) {
              setScreen({ kind: 'filename-overwrite', filename: trimmed });
            } else {
              setScreen({ kind: 'confirm', filename: trimmed });
            }
          }}
        />
      </Box>
    );
  }

  if (screen.kind === 'filename-overwrite') {
    const { filename } = screen;
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="yellow">File "{filename}" already exists. Overwrite?</Text>
        <Text dimColor>y = overwrite, n = choose another name</Text>
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={() => setScreen({ kind: 'confirm', filename })}
          onCancel={() => setScreen({ kind: 'filename' })}
        />
      </Box>
    );
  }

  if (screen.kind === 'confirm') {
    const { filename } = screen;
    const anchorStr = timeAnchor?.startTime
      ? `Start: ${timeAnchor.startTime}`
      : timeAnchor?.endTime
        ? `End deadline: ${timeAnchor.endTime}`
        : 'None (relative offsets)';

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="green">Ready to create:</Text>
        <Text>  Name:      {scheduleName}</Text>
        <Text>  Steps:     {steps.length}</Text>
        <Text>  Resources: {resources.length}</Text>
        <Text>  Anchor:    {anchorStr}</Text>
        <Text>  File:      {filename}</Text>
        <Text> </Text>
        <Text bold>Create this schedule?</Text>
        <Text dimColor>y = create and solve, n = go back to edit steps</Text>
        <ConfirmInput
          defaultChoice="confirm"
          onConfirm={() => {
            const schedule = buildSchedule();
            onComplete(schedule, filename);
            exit();
          }}
          onCancel={() => setScreen({ kind: 'step-list' })}
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
