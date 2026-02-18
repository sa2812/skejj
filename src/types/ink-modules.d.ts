// Ambient type declarations for ESM-only packages that don't resolve
// under moduleResolution: "node". tsx handles the actual imports at runtime.

declare module 'conf' {
  interface ConfOptions {
    projectName: string;
    defaults?: Record<string, unknown>;
  }
  class Conf {
    constructor(options: ConfOptions);
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    readonly store: Record<string, unknown>;
  }
  export default Conf;
}

declare module 'ink' {
  import type { ReactNode, ReactElement } from 'react';

  export interface RenderOptions {
    exitOnCtrlC?: boolean;
    patchConsole?: boolean;
    stdin?: NodeJS.ReadableStream;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
    debug?: boolean;
  }

  export interface RenderResult {
    waitUntilExit: () => Promise<void>;
    unmount: () => void;
    rerender: (tree: ReactElement) => void;
    cleanup: () => void;
    clear: () => void;
  }

  export interface BoxProps {
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    flexGrow?: number;
    flexShrink?: number;
    flexBasis?: number | string;
    gap?: number;
    alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
    justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
    borderStyle?: string;
    borderColor?: string;
    padding?: number;
    paddingX?: number;
    paddingY?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    margin?: number;
    marginX?: number;
    marginY?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    width?: number | string;
    height?: number | string;
    minWidth?: number;
    minHeight?: number;
    children?: ReactNode;
    [key: string]: unknown;
  }

  export interface TextProps {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
    color?: string;
    backgroundColor?: string;
    dimColor?: boolean;
    wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
    children?: ReactNode;
    [key: string]: unknown;
  }

  export function render(tree: ReactElement, options?: RenderOptions): RenderResult;

  export function Box(props: BoxProps): ReactElement;
  export function Text(props: TextProps): ReactElement;
  export function Static(props: { items: unknown[]; children: (item: unknown, index: number) => ReactElement }): ReactElement;
  export function Spacer(): ReactElement;
  export function Newline(props: { count?: number }): ReactElement;

  export function useApp(): { exit: (error?: Error) => void };
  export function useInput(
    inputHandler: (input: string, key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; pageDown: boolean; pageUp: boolean; return: boolean; escape: boolean; ctrl: boolean; shift: boolean; tab: boolean; backspace: boolean; delete: boolean; meta: boolean }) => void,
    options?: { isActive?: boolean }
  ): void;
  export function useStdin(): { stdin: NodeJS.ReadableStream; isRawModeSupported: boolean; setRawMode: (value: boolean) => void };
  export function useStdout(): { stdout: NodeJS.WritableStream; write: (data: string) => void };
  export function useFocus(options?: { autoFocus?: boolean; isActive?: boolean; id?: string }): { isFocused: boolean };
  export function useFocusManager(): { focusNext: () => void; focusPrevious: () => void; disableFocus: () => void; enableFocus: () => void; focus: (id: string) => void };
}

declare module '@inkjs/ui' {
  import type { ReactElement } from 'react';

  export interface SelectOption {
    label: string;
    value: string;
  }

  export interface SelectProps {
    options: SelectOption[];
    onChange: (value: string) => void;
    defaultValue?: string;
    isDisabled?: boolean;
    visibleOptionCount?: number;
    highlightText?: string;
  }

  export interface TextInputProps {
    placeholder?: string;
    defaultValue?: string;
    suggestions?: string[];
    isDisabled?: boolean;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
  }

  export interface ConfirmInputProps {
    defaultChoice?: 'confirm' | 'cancel';
    isDisabled?: boolean;
    submitOnEnter?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }

  export interface MultiSelectOption {
    label: string;
    value: string;
  }

  export interface MultiSelectProps {
    options: MultiSelectOption[];
    defaultValue?: string[];
    isDisabled?: boolean;
    visibleOptionCount?: number;
    highlightText?: string;
    onChange?: (values: string[]) => void;
    onSubmit?: (values: string[]) => void;
  }

  export interface SpinnerProps {
    label?: string;
  }

  export function Select(props: SelectProps): ReactElement;
  export function TextInput(props: TextInputProps): ReactElement;
  export function ConfirmInput(props: ConfirmInputProps): ReactElement;
  export function MultiSelect(props: MultiSelectProps): ReactElement;
  export function Spinner(props: SpinnerProps): ReactElement;
}
