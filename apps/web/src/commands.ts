type Command = "plan" | "shutdown";

let pending: Command | null = null;
const listeners = new Set<(command: Command) => void>();

export function requestCommand(command: Command) {
  pending = command;
  for (const listener of listeners) listener(command);
}

export function subscribeCommand(listener: (command: Command) => void) {
  listeners.add(listener);
  if (pending) listener(pending);
  return () => listeners.delete(listener);
}

export function takeCommand(command: Command) {
  if (pending === command) pending = null;
}
