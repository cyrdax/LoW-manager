import { open } from 'node:fs/promises';

import { parseListener } from './parser.js';
import {
  detectEncoding,
  type DecodedLine,
  type LogEncoding,
  StreamingLineDecoder,
} from './line-decoder.js';

const HEADER_BYTES = 64 * 1024;
const READ_BYTES = 64 * 1024;

interface FileIdentity {
  device: number;
  inode: number;
}

export interface TrackedRead {
  lines: DecodedLine[];
  truncated: boolean;
}

export class LogFileGoneError extends Error {
  readonly read: TrackedRead = { lines: [], truncated: false };

  constructor(filePath: string) {
    super(`Log file disappeared: ${filePath}`);
    this.name = 'LogFileGoneError';
  }
}

export class UnsupportedLogEncodingError extends Error {
  constructor(filePath: string) {
    super(`UTF-16BE log files are not supported: ${filePath}`);
    this.name = 'UnsupportedLogEncodingError';
  }
}

export class TrackedLog {
  characterName: string | null = null;

  private cursor: number;
  private readonly decoder: StreamingLineDecoder;

  private constructor(
    readonly filePath: string,
    readonly encoding: LogEncoding,
    private identity: FileIdentity,
  ) {
    this.cursor = 0;
    this.decoder = new StreamingLineDecoder(encoding);
  }

  static async open(filePath: string, mode: 'existing' | 'new'): Promise<TrackedLog> {
    const handle = await openLogFile(filePath);
    try {
      const fileStats = await handle.stat();
      const headerLength = Math.min(fileStats.size, HEADER_BYTES);
      const header = Buffer.alloc(headerLength);
      if (headerLength > 0) {
        await handle.read(header, 0, headerLength, 0);
      }

      if (header[0] === 0xfe && header[1] === 0xff) {
        throw new UnsupportedLogEncodingError(filePath);
      }

      const tracked = new TrackedLog(
        filePath,
        detectEncoding(header),
        identityFrom(fileStats),
      );

      if (mode === 'existing') {
        tracked.updateCharacterName(tracked.decoder.push(header, 0));
        tracked.cursor = fileStats.size;
        tracked.decoder.reset(tracked.cursor);
      }

      return tracked;
    } finally {
      await handle.close();
    }
  }

  async readAppended(): Promise<TrackedRead> {
    const handle = await openLogFile(this.filePath);
    try {
      const fileStats = await handle.stat();
      let truncated = false;
      if (!sameIdentity(this.identity, identityFrom(fileStats)) || fileStats.size < this.cursor) {
        this.identity = identityFrom(fileStats);
        this.cursor = 0;
        this.decoder.reset(0);
        truncated = true;
      }

      const lines: DecodedLine[] = [];
      let remaining = fileStats.size - this.cursor;
      while (remaining > 0) {
        const length = Math.min(remaining, READ_BYTES);
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, this.cursor);
        if (bytesRead === 0) {
          break;
        }

        const decoded = this.decoder.push(bytes.subarray(0, bytesRead), this.cursor);
        this.cursor += bytesRead;
        remaining -= bytesRead;
        this.updateCharacterName(decoded);
        lines.push(...decoded);
      }

      return { lines, truncated };
    } finally {
      await handle.close();
    }
  }

  private updateCharacterName(lines: DecodedLine[]): void {
    for (const line of lines) {
      const listener = parseListener(line.text);
      if (listener !== null) {
        this.characterName = listener;
      }
    }
  }
}

async function openLogFile(filePath: string) {
  try {
    return await open(filePath, 'r');
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new LogFileGoneError(filePath);
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function identityFrom(stats: { dev: number; ino: number }): FileIdentity {
  return { device: stats.dev, inode: stats.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
