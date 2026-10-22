const MAX_LENGTH = 200_000;

/**
 * `JSON.stringify` that never throws: cycles, functions, symbols, bigints,
 * errors, maps and sets are rendered as readable placeholders.
 */
export function safeStringify(value: unknown, space = 2): string {
  const ancestors: object[] = [];
  const json = JSON.stringify(
    value,
    function (this: unknown, _key: string, current: unknown): unknown {
      if (typeof current === "bigint") {
        return `${current}n`;
      }
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (typeof current === "symbol") {
        return current.toString();
      }
      if (current instanceof Error) {
        return { name: current.name, message: current.message };
      }
      if (current instanceof Map) {
        return Object.fromEntries(current);
      }
      if (current instanceof Set) {
        return [...current];
      }
      if (typeof current === "object" && current !== null) {
        while (
          ancestors.length > 0 &&
          ancestors[ancestors.length - 1] !== this
        ) {
          ancestors.pop();
        }
        if (ancestors.includes(current)) {
          return "[Circular]";
        }
        ancestors.push(current);
      }
      return current;
    },
    space,
  );
  if (json === undefined) {
    return String(value);
  }
  return json.length > MAX_LENGTH
    ? `${json.slice(0, MAX_LENGTH)}\n… (${json.length - MAX_LENGTH} more characters)`
    : json;
}
