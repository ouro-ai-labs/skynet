import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Logger } from '../logger.js';

function tmpLogPath(): string {
  const dir = join(tmpdir(), 'skynet-logger-test', randomUUID());
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.log');
}

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }
  cleanupPaths.length = 0;
});

function waitForFlush(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Logger', () => {
  it('writes log lines to file', async () => {
    const filePath = tmpLogPath();
    cleanupPaths.push(filePath);

    const logger = new Logger('test', { filePath, console: false });
    logger.info('hello world');
    logger.error('something broke', new Error('oops'));
    logger.close();
    await waitForFlush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('[INFO ]');
    expect(content).toContain('[test]');
    expect(content).toContain('hello world');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('something broke');
    expect(content).toContain('oops');
  });

  it('respects log level filtering', async () => {
    const filePath = tmpLogPath();
    cleanupPaths.push(filePath);

    const logger = new Logger('lvl', { filePath, level: 'warn', console: false });
    logger.debug('should not appear');
    logger.info('should not appear either');
    logger.warn('this should appear');
    logger.error('this too');
    logger.close();
    await waitForFlush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('should not appear');
    expect(content).toContain('this should appear');
    expect(content).toContain('this too');
  });

  it('creates log directory if it does not exist', async () => {
    const dir = join(tmpdir(), 'skynet-logger-test', randomUUID(), 'nested', 'dir');
    const filePath = join(dir, 'test.log');
    cleanupPaths.push(join(tmpdir(), 'skynet-logger-test'));

    const logger = new Logger('mkdir', { filePath, console: false });
    logger.info('created dir');
    logger.close();
    await waitForFlush();

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('created dir');
  });

  it('appends to existing file', async () => {
    const filePath = tmpLogPath();
    cleanupPaths.push(filePath);

    const logger1 = new Logger('a', { filePath, console: false });
    logger1.info('first');
    logger1.close();
    await waitForFlush();

    const logger2 = new Logger('b', { filePath, console: false });
    logger2.info('second');
    logger2.close();
    await waitForFlush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });

  it('works with console-only mode (no file)', () => {
    const logger = new Logger('console-only', { console: true });
    // Should not throw
    logger.info('no file');
    logger.close();
  });

  it('formats extra args including objects and errors', async () => {
    const filePath = tmpLogPath();
    cleanupPaths.push(filePath);

    const logger = new Logger('fmt', { filePath, console: false });
    logger.info('data', { key: 'value' });
    logger.error('fail', new Error('stack trace'));
    logger.close();
    await waitForFlush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('"key":"value"');
    expect(content).toContain('stack trace');
  });

  it('child logger inherits namespace prefix', async () => {
    const filePath = tmpLogPath();
    cleanupPaths.push(filePath);

    const parent = new Logger('parent', { filePath, console: false });
    const child = parent.child('child');
    child.info('from child');
    parent.close();
    child.close();
    await waitForFlush();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('[parent:child]');
    expect(content).toContain('from child');
  });
});
