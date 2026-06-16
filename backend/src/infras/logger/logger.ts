import type { Config } from '@config/config';
import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(config: Config): pino.Logger {
  const isPretty = config.app.env === 'development';

  const options: pino.LoggerOptions = {
    level: config.log.level,
    ...(isPretty && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
    ...(!isPretty && {
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    }),
  };

  return pino(options);
}
