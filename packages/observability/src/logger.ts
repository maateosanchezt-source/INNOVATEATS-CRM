import pino, { type LoggerOptions } from "pino";

const redactPaths = [
  "accessToken",
  "authorization",
  "clientSecret",
  "cookie",
  "headers.authorization",
  "headers.cookie",
  "idToken",
  "password",
  "refreshToken",
  "secret",
  "*.accessToken",
  "*.clientSecret",
  "*.idToken",
  "*.password",
  "*.refreshToken",
  "*.secret"
];

export function createLogger(name: string, options: Readonly<Pick<LoggerOptions, "level">> = {}) {
  return pino({
    base: { service: name },
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: redactPaths,
      censor: "[REDACTED]"
    },
    timestamp: pino.stdTimeFunctions.isoTime
  });
}
