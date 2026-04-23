/**
 * Structured logger for OTXEngine.
 * Wraps console with structured JSON output in production.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, any>;
  timestamp: string;
  trace_id?: string;
}

class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, data?: Record<string, any>, trace_id?: string) {
    const entry: LogEntry = {
      level,
      module: this.module,
      message,
      data,
      timestamp: new Date().toISOString(),
      trace_id,
    };
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (process.env.NODE_ENV === 'production') {
      fn(JSON.stringify(entry));
    } else {
      const prefix = `[${entry.timestamp.slice(11, 19)}][${level.toUpperCase()}][${this.module}]`;
      fn(prefix, message, data ? data : '');
    }
  }

  debug(msg: string, data?: Record<string, any>, trace_id?: string) { this.log('debug', msg, data, trace_id); }
  info(msg: string, data?: Record<string, any>, trace_id?: string)  { this.log('info',  msg, data, trace_id); }
  warn(msg: string, data?: Record<string, any>, trace_id?: string)  { this.log('warn',  msg, data, trace_id); }
  error(msg: string, data?: Record<string, any>, trace_id?: string) { this.log('error', msg, data, trace_id); }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
