import type { Dictionary } from "./dictionaries/en";

type EnumKind = keyof Dictionary["enums"];

/**
 * Translate a raw enum value (risk level, status, priority, health, sync status,
 * category) via the dictionary, falling back to a prettified value if a key is
 * missing (belt-and-suspenders; keys are complete at compile time).
 */
export function tEnum(t: Dictionary, kind: EnumKind, value: string): string {
  const map = t.enums[kind] as Record<string, string>;
  return (
    map[value] ??
    value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
