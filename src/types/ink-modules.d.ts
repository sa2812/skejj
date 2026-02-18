// Ambient type declarations for packages that don't resolve
// under moduleResolution: "NodeNext".
// ink and @inkjs/ui are resolved natively via their package.json exports.
// conf v15 does not include type declarations resolvable by NodeNext, so
// we keep the ambient declaration for it.

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
