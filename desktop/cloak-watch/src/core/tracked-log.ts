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
  private decoder: StreamingLineDecoder | null = null;
  private selectedEncoding: LogEncoding | null;
  private pendingEncodingBytes = Buffer.alloc(0);
  private pendingEncodingOffset = 0;
  private discardFirstDecodedLine = false;

  private constructor(
    readonly filePath: string,
    encoding: LogEncoding | null,
    private identity: FileIdentity,
  ) {
    this.cursor = 0;
    this.selectedEncoding = encoding;
    if (encoding !== null) {
      this.decoder = new StreamingLineDecoder(encoding);
    }
  }

  get encoding(): LogEncoding {
    return this.selectedEncoding ?? 'utf8';
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

      if (hasUtf16BeBom(header)) {
        throw new UnsupportedLogEncodingError(filePath);
      }

      const tracked = new TrackedLog(
        filePath,
        detectEncoding(header),
        identityFrom(fileStats),
      );

      if (mode === 'existing') {
        tracked.updateCharacterName(tracked.decodeBytes(header, 0));
        tracked.cursor = fileStats.size;
        await tracked.prepareExistingTail(handle, fileStats.size);
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
        this.resetGeneration();
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

        const decoded = this.decodeBytes(bytes.subarray(0, bytesRead), this.cursor);
        this.cursor += bytesRead;
        remaining -= bytesRead;
        this.updateCharacterName(decoded);
        lines.push(...this.removeHistoricalFirstLine(decoded));
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

  private decodeBytes(bytes: Uint8Array, startOffset: number): DecodedLine[] {
    if (this.decoder !== null) {
      return this.decoder.push(bytes, startOffset);
    }

    if (this.pendingEncodingBytes.length === 0) {
      this.pendingEncodingOffset = startOffset;
    }
    this.pendingEncodingBytes = Buffer.concat([this.pendingEncodingBytes, Buffer.from(bytes)]);
    if (hasUtf16BeBom(this.pendingEncodingBytes)) {
      throw new UnsupportedLogEncodingError(this.filePath);
    }

    const encoding = detectEncoding(this.pendingEncodingBytes);
    if (encoding === null) {
      return [];
    }

    this.selectedEncoding = encoding;
    this.decoder = new StreamingLineDecoder(encoding);
    const pendingBytes = this.pendingEncodingBytes;
    const pendingOffset = this.pendingEncodingOffset;
    this.pendingEncodingBytes = Buffer.alloc(0);
    return this.decoder.push(pendingBytes, pendingOffset);
  }

  private async prepareExistingTail(handle: Awaited<ReturnType<typeof open>>, size: number): Promise<void> {
    const encoding = this.selectedEncoding;
    if (this.decoder === null || encoding === null) {
      return;
    }

    const tailLength = Math.min(size, encoding === 'utf16le' ? 2 : 1);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) {
      await handle.read(tail, 0, tailLength, size - tailLength);
    }

    this.decoder.reset(size);
    if (endsWithLineBreak(tail, encoding)) {
      return;
    }

    if (tailLength > 0) {
      this.decoder.push(tail.subarray(tailLength - 1), size - 1);
      this.discardFirstDecodedLine = true;
    }
  }

  private removeHistoricalFirstLine(lines: DecodedLine[]): DecodedLine[] {
    if (!this.discardFirstDecodedLine || lines.length === 0) {
      return lines;
    }

    this.discardFirstDecodedLine = false;
    return lines.slice(1);
  }

  private resetGeneration(): void {
    this.characterName = null;
    this.cursor = 0;
    this.decoder = null;
    this.selectedEncoding = null;
    this.pendingEncodingBytes = Buffer.alloc(0);
    this.pendingEncodingOffset = 0;
    this.discardFirstDecodedLine = false;
  }

}

function hasUtf16BeBom(prefix: Uint8Array): boolean {
  return prefix[0] === 0xfe && prefix[1] === 0xff;
}

function endsWithLineBreak(bytes: Uint8Array, encoding: LogEncoding): boolean {
  if (encoding === 'utf8') {
    return bytes.at(-1) === 0x0a;
  }
  return bytes.length === 2 && bytes[0] === 0x0a && bytes[1] === 0x00;
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
