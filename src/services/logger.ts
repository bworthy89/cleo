import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

export function initLogger() {
  if (initialized || !SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    environment: __DEV__ ? 'development' : 'production',
  });

  initialized = true;
}

/**
 * Structured logger with Sentry integration.
 * In dev: console output. In production: Sentry breadcrumbs + error capture.
 */
export const logger = {
  info(tag: string, message: string, data?: Record<string, unknown>) {
    if (__DEV__) {
      console.log(`[${tag}] ${message}`, data ?? '');
    }
    if (initialized) {
      Sentry.addBreadcrumb({ category: tag, message, data, level: 'info' });
    }
  },

  warn(tag: string, message: string, error?: unknown) {
    if (__DEV__) {
      console.warn(`[${tag}] ${message}`, error ?? '');
    }
    if (initialized) {
      Sentry.addBreadcrumb({
        category: tag,
        message,
        level: 'warning',
        data: error instanceof Error ? { error: error.message } : undefined,
      });
    }
  },

  error(tag: string, message: string, error?: unknown) {
    if (__DEV__) {
      console.error(`[${tag}] ${message}`, error ?? '');
    }
    if (initialized) {
      if (error instanceof Error) {
        Sentry.captureException(error, { tags: { component: tag }, extra: { message } });
      } else {
        Sentry.captureMessage(`[${tag}] ${message}`, 'error');
      }
    }
  },

  setUser(id: string, email?: string) {
    if (initialized) {
      Sentry.setUser({ id, email });
    }
  },

  clearUser() {
    if (initialized) {
      Sentry.setUser(null);
    }
  },
};
