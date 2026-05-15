import type { LogEntry, LogLevel } from "@/types";

export function makeUiLogEntry(
  level: LogLevel,
  source: string,
  message: string,
): LogEntry {
  return {
    level,
    source,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function writeLogToConsole(entry: LogEntry): void {
  const text = `[${entry.timestamp}] [${entry.source}] ${entry.message}`;
  if (entry.level === "error") {
    console.error(text);
    return;
  }
  if (entry.level === "warn") {
    console.warn(text);
    return;
  }
  if (entry.level === "debug") {
    console.debug(text);
    return;
  }
  console.info(text);
}
