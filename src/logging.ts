/**
 * Structured logging for Cloud Run.
 *
 * Cloud Logging parses a single-line JSON object on stdout into `jsonPayload`
 * and promotes the `severity` and `message` fields. Plain `console.log` output
 * lands as unstructured text with severity DEFAULT, which is why the previous
 * version of this service had no usable logs at all.
 */

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

type Fields = Record<string, unknown>;

const serialiseError = (error: unknown): Fields => {
    if (error instanceof Error) {
        return {
            error: error.message,
            errorName: error.name,
            stack: error.stack,
        };
    }
    return { error: String(error) };
};

const emit = (severity: Severity, message: string, fields?: Fields): void => {
    const entry = { severity, message, ...fields };
    const line = JSON.stringify(entry, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );
    // stderr for ERROR so it also surfaces in the Cloud Run "errors" view.
    if (severity === 'ERROR') {
        process.stderr.write(`${line}\n`);
    } else {
        process.stdout.write(`${line}\n`);
    }
};

export const logger = {
    debug: (message: string, fields?: Fields) => emit('DEBUG', message, fields),
    info: (message: string, fields?: Fields) => emit('INFO', message, fields),
    warn: (message: string, fields?: Fields) => emit('WARNING', message, fields),
    error: (message: string, error?: unknown, fields?: Fields) =>
        emit('ERROR', message, { ...fields, ...(error === undefined ? {} : serialiseError(error)) }),
};
