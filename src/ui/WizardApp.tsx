import React, { useReducer } from 'react';
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

// ---- useReducer state and actions ------------------------------------------

type WizardState = {
  screen: WizardScreen;
  scheduleName: string;
  steps: StepDraft[];
  resources: ResourceDraft[];
  resourceNeeds: ResourceNeed[];
  timeAnchor: { startTime?: string; endTime?: string } | null;
  inputError: string | null;
};

type WizardAction =
  | { type: 'NAV'; screen: WizardScreen }
  | { type: 'SET_NAME'; name: string }
  | { type: 'ADD_STEP'; step: StepDraft }
  | { type: 'EDIT_STEP'; index: number; step: StepDraft }
  | { type: 'REMOVE_STEP'; index: number }
  | { type: 'ADD_RESOURCE'; resource: ResourceDraft }
  | { type: 'ADD_RESOURCE_NEED'; need: ResourceNeed }
  | { type: 'SET_TIME_ANCHOR'; anchor: WizardState['timeAnchor'] }
  | { type: 'ERROR'; msg: string | null };

const initialWizardState: WizardState = {
  screen: { kind: 'schedule-name' },
  scheduleName: '',
  steps: [],
  resources: [],
  resourceNeeds: [],
  timeAnchor: null,
  inputError: null,
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'NAV':
      return { ...state, screen: action.screen, inputError: null };
    case 'SET_NAME':
      return { ...state, scheduleName: action.name };
    case 'ADD_STEP':
      return { ...state, steps: [...state.steps, action.step] };
    case 'EDIT_STEP':
      return {
        ...state,
        steps: state.steps.map((s, i) => i === action.index ? action.step : s),
      };
    case 'REMOVE_STEP': {
      const removedId = state.steps[action.index].id;
      return {
        ...state,
        steps: state.steps
          .filter((_, i) => i !== action.index)
          .map((s) => ({
            ...s,
            dependencies: s.dependencies.filter((d) => d.stepId !== removedId),
          })),
        resourceNeeds: state.resourceNeeds.filter((rn) => rn.stepId !== removedId),
      };
    }
    case 'ADD_RESOURCE':
      return { ...state, resources: [...state.resources, action.resource] };
    case 'ADD_RESOURCE_NEED':
      return {
        ...state,
        resourceNeeds: [
          ...state.resourceNeeds.filter(
            (rn) => !(rn.stepId === action.need.stepId && rn.resourceId === action.need.resourceId)
          ),
          action.need,
        ],
      };
    case 'SET_TIME_ANCHOR':
      return { ...state, timeAnchor: action.anchor };
    case 'ERROR':
      return { ...state, inputError: action.msg };
    default:
      return state;
  }
}

// ---- advance resource-needs helper -----------------------------------------

function advanceResourceNeeds(
  stepIndex: number,
  resourceIdx: number,
  steps: StepDraft[],
  resources: ResourceDraft[]
): WizardScreen {
  const nextStepIdx = stepIndex + 1;
  if (nextStepIdx < steps.length) {
    return { kind: 'resource-needs-step', stepIndex: nextStepIdx, resourceIdx };
  }
  const nextResourceIdx = resourceIdx + 1;
  if (nextResourceIdx < resources.length) {
    return { kind: 'resource-needs-step', stepIndex: 0, resourceIdx: nextResourceIdx };
  }
  return { kind: 'time-anchor' };
}

// ---- main component --------------------------------------------------------

export interface WizardAppProps {
  onComplete: (schedule: ScheduleInput, filename: string) => void;
}

export default function WizardApp({ onComplete }: WizardAppProps) {
  const { exit } = useApp();

  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const { screen, scheduleName, steps, resources, resourceNeeds, timeAnchor, inputError } = state;

  function buildSchedule(): ScheduleInput {
    const schedId = toKebab(state.scheduleName) || 'schedule';
    const builtSteps = state.steps.map((s) => ({
      id: s.id,
      title: s.title,
      durationMins: s.durationMins,
      dependencies: s.dependencies,
      resourceNeeds: state.resourceNeeds
        .filter((rn) => rn.stepId === s.id)
        .map((rn) => ({ resourceId: rn.resourceId, quantity: rn.quantity })),
    }));

    return {
      id: schedId,
      name: state.scheduleName,
      steps: builtSteps,
      tracks: [],
      resources: state.resources.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        roles: [],
        capacity: r.capacity,
      })),
      ...(state.timeAnchor ? { timeConstraint: state.timeAnchor } : {}),
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
          key="schedule-name"
          placeholder="e.g. Roast Chicken Dinner"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { dispatch({ type: 'ERROR', msg: 'Name cannot be empty' }); return; }
            dispatch({ type: 'SET_NAME', name: trimmed });
            dispatch({ type: 'NAV', screen: { kind: 'step-list' } });
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
          if (val === 'add') { dispatch({ type: 'NAV', screen: { kind: 'add-step-title' } }); return; }
          if (val === 'edit') { dispatch({ type: 'NAV', screen: { kind: 'edit-step-select' } }); return; }
          if (val === 'remove') { dispatch({ type: 'NAV', screen: { kind: 'remove-step-select' } }); return; }
          if (val === 'done') { dispatch({ type: 'NAV', screen: { kind: 'resources-prompt' } }); return; }
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
          key={screen.kind}
          placeholder="e.g. Preheat Oven"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { dispatch({ type: 'ERROR', msg: 'Title cannot be empty' }); return; }
            dispatch({ type: 'NAV', screen: { kind: 'add-step-duration', title: trimmed } });
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
          key={screen.kind}
          placeholder="e.g. 30"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { dispatch({ type: 'ERROR', msg: 'Enter a positive integer (minutes)' }); return; }
            dispatch({ type: 'NAV', screen: { kind: 'add-step-deps', title, durationMins: n } });
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
      dispatch({ type: 'ADD_STEP', step: newStep });
      dispatch({ type: 'NAV', screen: { kind: 'step-list' } });
    };

    if (depOptions.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>New step "{title}" — no prior steps to depend on.</Text>
          <Text dimColor>Press enter to add step</Text>
          <TextInput
            key="add-step-deps-confirm"
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
            if (val === 'back') { dispatch({ type: 'NAV', screen: { kind: 'step-list' } }); return; }
            dispatch({ type: 'NAV', screen: { kind: 'edit-step-title', index: parseInt(val, 10) } });
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
          key={`${screen.kind}-${index}`}
          defaultValue={step.title}
          onSubmit={(val) => {
            const trimmed = val.trim() || step.title;
            dispatch({ type: 'NAV', screen: { kind: 'edit-step-duration', index, title: trimmed } });
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
          key={`${screen.kind}-${index}`}
          defaultValue={String(step.durationMins)}
          onSubmit={(val) => {
            const trimmed = val.trim();
            const n = trimmed ? parseInt(trimmed, 10) : step.durationMins;
            if (isNaN(n) || n <= 0) { dispatch({ type: 'ERROR', msg: 'Enter a positive integer' }); return; }
            dispatch({ type: 'NAV', screen: { kind: 'edit-step-deps', index, title, durationMins: n } });
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

      const updatedSteps = steps.map((s, i) => {
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

      // Apply each updated step via EDIT_STEP actions
      updatedSteps.forEach((s, i) => {
        dispatch({ type: 'EDIT_STEP', index: i, step: s });
      });
      dispatch({ type: 'NAV', screen: { kind: 'step-list' } });
    };

    if (depOptions.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Edit step "{title}" — no other steps to depend on.</Text>
          <Text dimColor>Press enter to save</Text>
          <TextInput
            key="edit-step-deps-confirm"
            placeholder=""
            onSubmit={() => commitEdit([])}
          />
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
            if (val === 'back') { dispatch({ type: 'NAV', screen: { kind: 'step-list' } }); return; }
            const idx = parseInt(val, 10);
            dispatch({ type: 'REMOVE_STEP', index: idx });
            dispatch({ type: 'NAV', screen: { kind: 'step-list' } });
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
          onConfirm={() => dispatch({ type: 'NAV', screen: { kind: 'add-resource-name' } })}
          onCancel={() => dispatch({ type: 'NAV', screen: { kind: 'time-anchor' } })}
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
          key={screen.kind}
          placeholder="e.g. Oven, Kitchen Staff"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { dispatch({ type: 'ERROR', msg: 'Name cannot be empty' }); return; }
            dispatch({ type: 'NAV', screen: { kind: 'add-resource-kind', name: trimmed } });
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
            dispatch({
              type: 'NAV',
              screen: {
                kind: 'add-resource-capacity',
                name,
                resourceKind: val as 'Equipment' | 'People' | 'Consumable',
              },
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
          key={screen.kind}
          placeholder="e.g. 1"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { dispatch({ type: 'ERROR', msg: 'Enter a positive integer' }); return; }
            const existingIds = resources.map((r) => r.id);
            const newId = uniqueId(toKebab(name), existingIds);
            dispatch({ type: 'ADD_RESOURCE', resource: { id: newId, name, kind, capacity: n } });
            dispatch({ type: 'NAV', screen: { kind: 'more-resources' } });
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
          onConfirm={() => dispatch({ type: 'NAV', screen: { kind: 'add-resource-name' } })}
          onCancel={() => {
            if (steps.length > 0 && resources.length > 0) {
              dispatch({ type: 'NAV', screen: { kind: 'resource-needs-step', stepIndex: 0, resourceIdx: 0 } });
            } else {
              dispatch({ type: 'NAV', screen: { kind: 'time-anchor' } });
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
      dispatch({ type: 'NAV', screen: { kind: 'time-anchor' } });
      return <Box><Text>...</Text></Box>;
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Does "{step.title}" need "{resource.name}"?</Text>
        <Text dimColor>y = yes, n = no</Text>
        <ConfirmInput
          defaultChoice="cancel"
          onConfirm={() => dispatch({ type: 'NAV', screen: { kind: 'resource-needs-qty', stepIndex, resourceIdx } })}
          onCancel={() => dispatch({
            type: 'NAV',
            screen: advanceResourceNeeds(stepIndex, resourceIdx, steps, resources),
          })}
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
          key={screen.kind}
          placeholder="e.g. 1"
          onSubmit={(val) => {
            const n = parseInt(val.trim(), 10);
            if (isNaN(n) || n <= 0) { dispatch({ type: 'ERROR', msg: 'Enter a positive integer' }); return; }
            dispatch({ type: 'ADD_RESOURCE_NEED', need: { stepId: step.id, resourceId: resource.id, quantity: n } });
            dispatch({
              type: 'NAV',
              screen: advanceResourceNeeds(stepIndex, resourceIdx, steps, resources),
            });
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
              dispatch({ type: 'SET_TIME_ANCHOR', anchor: null });
              dispatch({ type: 'NAV', screen: { kind: 'filename' } });
            } else {
              dispatch({ type: 'NAV', screen: { kind: 'time-anchor-value', anchor: val as 'start' | 'end' } });
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
          key={screen.kind}
          placeholder="2026-02-18T17:00:00"
          onSubmit={(val) => {
            const trimmed = val.trim();
            if (!trimmed) { dispatch({ type: 'ERROR', msg: 'Time value cannot be empty' }); return; }
            dispatch({
              type: 'SET_TIME_ANCHOR',
              anchor: anchor === 'start' ? { startTime: trimmed } : { endTime: trimmed },
            });
            dispatch({ type: 'NAV', screen: { kind: 'filename' } });
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
          key="filename"
          defaultValue={suggested}
          onSubmit={(val) => {
            const trimmed = val.trim() || suggested;
            const fullPath = path.resolve(process.cwd(), trimmed);
            if (fs.existsSync(fullPath)) {
              dispatch({ type: 'NAV', screen: { kind: 'filename-overwrite', filename: trimmed } });
            } else {
              dispatch({ type: 'NAV', screen: { kind: 'confirm', filename: trimmed } });
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
          onConfirm={() => dispatch({ type: 'NAV', screen: { kind: 'confirm', filename } })}
          onCancel={() => dispatch({ type: 'NAV', screen: { kind: 'filename' } })}
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
          onCancel={() => dispatch({ type: 'NAV', screen: { kind: 'step-list' } })}
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
