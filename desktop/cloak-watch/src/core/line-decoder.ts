export type LogEncoding = 'utf8' | 'utf16le';

export interface DecodedLine {
  text: string;
  byteOffset: number;
}

export function detectEncoding(prefix: Uint8Array): LogEncoding | null {
  if (prefix.length === 0 || prefix[0] === 0xff || prefix[0] === 0xfe) {
    return prefix.length < 2 ? null : prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf16le' : 'utf8';
  }
  if (prefix[0] === 0xef && prefix.length < 3) {
    return null;
  }
  return 'utf8';
}

export class StreamingLineDecoder {
  private buffered = Buffer.alloc(0);
  private bufferedOffset = 0;
  private isFirstLine = true;

  constructor(private readonly encoding: LogEncoding) {}

  push(bytes: Uint8Array, startOffset: number): DecodedLine[] {
    if (this.buffered.length === 0) {
      this.bufferedOffset = startOffset;
    }
    this.buffered = Buffer.concat([this.buffered, Buffer.from(bytes)]);

    const lines: DecodedLine[] = [];
    let newlineIndex = this.findNewline();
    while (newlineIndex !== -1) {
      const lineEnd = this.hasCarriageReturnBefore(newlineIndex)
        ? newlineIndex - (this.encoding === 'utf8' ? 1 : 2)
        : newlineIndex;
      let text = this.buffered.subarray(0, lineEnd).toString(this.encoding);
      if (this.isFirstLine) {
        text = text.replace(/^\uFEFF/, '');
        this.isFirstLine = false;
      }

      lines.push({ text, byteOffset: this.bufferedOffset });

      const consumed = newlineIndex + (this.encoding === 'utf8' ? 1 : 2);
      this.buffered = this.buffered.subarray(consumed);
      this.bufferedOffset += consumed;
      newlineIndex = this.findNewline();
    }

    return lines;
  }

  reset(nextOffset = 0): void {
    this.buffered = Buffer.alloc(0);
    this.bufferedOffset = nextOffset;
    this.isFirstLine = true;
  }

  private findNewline(): number {
    if (this.encoding === 'utf8') {
      return this.buffered.indexOf(0x0a);
    }

    for (let index = 0; index + 1 < this.buffered.length; index += 1) {
      if (
        (this.bufferedOffset + index) % 2 === 0 &&
        this.buffered[index] === 0x0a &&
        this.buffered[index + 1] === 0x00
      ) {
        return index;
      }
    }
    return -1;
  }

  private hasCarriageReturnBefore(newlineIndex: number): boolean {
    if (this.encoding === 'utf8') {
      return newlineIndex > 0 && this.buffered[newlineIndex - 1] === 0x0d;
    }

    return (
      newlineIndex >= 2 &&
      this.buffered[newlineIndex - 2] === 0x0d &&
      this.buffered[newlineIndex - 1] === 0x00
    );
  }
}
