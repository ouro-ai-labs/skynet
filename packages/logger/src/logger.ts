import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WriteStream } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  /** Log file path. If not set, only logs to console. */
  filePath?: string;
  /** Minimum log level. Default: 'info' */
  level?: LogLevel;
  /** Whether to also log to console. Default: true */
  console?: boolean;
}

export class Logger {
  private stream: WriteStream | null = null;
  private minLevel: number;
  private logToConsole: boolean;

  constructor(
    private namespace: string,
    private options: LoggerOptions = {},
  ) {
    this.minLevel = LEVEL_VALUE[options.level ?? 'info'];
    this.logToConsole = options.console ?? true;

    if (options.filePath) {
      const dir = dirname(options.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.stream = createWriteStream(options.filePath, { flags: 'a' });
    }
  }

  debug(msg: string, ...args: unknown[]): void {
    this.write('debug', msg, args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.write('info', msg, args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.write('warn', msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.write('error', msg, args);
  }

  child(namespace: string): Logger {
    return new Logger(`${this.namespace}:${namespace}`, {
      ...this.options,
      // Share the same file stream instead of opening a new one
    });
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  private write(level: LogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_VALUE[level] < this.minLevel) return;

    const timestamp = new Date().toISOString();
    const extra =
      args.length > 0
        ? ' ' +
          args
            .map((a) =>
              a instanceof Error
                ? a.stack ?? a.message
                : typeof a === 'string'
                  ? a
                  : JSON.stringify(a),
            )
            .join(' ')
        : '';
    const line = `${timestamp} [${level.toUpperCase().padEnd(5)}] [${this.namespace}] ${msg}${extra}`;

    if (this.stream) {
      this.stream.write(line + '\n');
    }

    if (this.logToConsole) {
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
  }
}
