/**
 * Simple structured logger for the webhook handler
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  subitemId?: number | string;
  parentId?: number | string;
  mainItemIds?: (number | string)[];
  boardId?: number | string;
  columnId?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    console.debug(formatLog('debug', message, context));
  },
  
  info(message: string, context?: LogContext): void {
    console.log(formatLog('info', message, context));
  },
  
  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context));
  },
  
  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context));
  },
};
