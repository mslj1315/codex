// Task persistence remains route-local in this first increment; shared snapshot utilities live here.
export function immutableSnapshot(value: unknown): string { return JSON.stringify(value); }
