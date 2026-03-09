import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Attachment, MAX_ATTACHMENT_SIZE } from '@skynet-ai/protocol';

const execFileAsync = promisify(execFile);

type Platform = 'darwin' | 'linux';

interface ClipboardImageResult {
  attachment: Attachment;
}

/** Check if the system clipboard contains an image and read it. */
export async function readClipboardImage(): Promise<ClipboardImageResult | null> {
  const platform = process.platform as Platform;

  switch (platform) {
    case 'darwin':
      return readClipboardImageDarwin();
    case 'linux':
      return readClipboardImageLinux();
    default:
      return null;
  }
}

async function readClipboardImageDarwin(): Promise<ClipboardImageResult | null> {
  // Check if clipboard has image data
  let clipInfo: string;
  try {
    const result = await execFileAsync('osascript', ['-e', 'clipboard info']);
    clipInfo = result.stdout;
  } catch {
    return null;
  }

  if (!/PNGf|TIFF|JPEG|public\.png|public\.tiff/.test(clipInfo)) {
    return null;
  }

  // Write clipboard image to temp file
  const tmpPath = join(tmpdir(), `skynet-paste-${randomUUID()}.png`);
  try {
    await execFileAsync('osascript', [
      '-e',
      `set imgData to the clipboard as «class PNGf»
set f to open for access (POSIX file "${tmpPath}") with write permission
write imgData to f
close access f`,
    ]);

    const data = await readFile(tmpPath);
    await unlink(tmpPath).catch(() => {});

    if (data.length === 0) {
      return null;
    }

    if (data.length > MAX_ATTACHMENT_SIZE) {
      throw new Error(
        `Image too large: ${formatSize(data.length)} (max ${formatSize(MAX_ATTACHMENT_SIZE)})`,
      );
    }

    return {
      attachment: {
        type: 'image',
        mimeType: 'image/png',
        name: 'clipboard.png',
        data: data.toString('base64'),
        size: data.length,
      },
    };
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    if (err instanceof Error && err.message.startsWith('Image too large')) {
      throw err;
    }
    return null;
  }
}

async function readClipboardImageLinux(): Promise<ClipboardImageResult | null> {
  // Try Wayland first (wl-paste), then X11 (xclip)
  const result = await readClipboardImageWayland() ?? await readClipboardImageX11();
  return result;
}

async function readClipboardImageWayland(): Promise<ClipboardImageResult | null> {
  try {
    // Check available MIME types
    const { stdout: types } = await execFileAsync('wl-paste', ['--list-types']);
    if (!/image\/png/.test(types)) {
      return null;
    }

    const tmpPath = join(tmpdir(), `skynet-paste-${randomUUID()}.png`);
    try {
      await execFileAsync('bash', ['-c', `wl-paste --type image/png > "${tmpPath}"`]);
      const data = await readFile(tmpPath);
      await unlink(tmpPath).catch(() => {});

      if (data.length === 0) return null;
      if (data.length > MAX_ATTACHMENT_SIZE) {
        throw new Error(
          `Image too large: ${formatSize(data.length)} (max ${formatSize(MAX_ATTACHMENT_SIZE)})`,
        );
      }

      return {
        attachment: {
          type: 'image',
          mimeType: 'image/png',
          name: 'clipboard.png',
          data: data.toString('base64'),
          size: data.length,
        },
      };
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      if (err instanceof Error && err.message.startsWith('Image too large')) throw err;
      return null;
    }
  } catch {
    // wl-paste not available
    return null;
  }
}

async function readClipboardImageX11(): Promise<ClipboardImageResult | null> {
  try {
    // Check clipboard targets
    const { stdout: targets } = await execFileAsync('xclip', [
      '-selection', 'clipboard', '-t', 'TARGETS', '-o',
    ]);
    if (!/image\/png/.test(targets)) {
      return null;
    }

    const tmpPath = join(tmpdir(), `skynet-paste-${randomUUID()}.png`);
    try {
      await execFileAsync('bash', [
        '-c',
        `xclip -selection clipboard -t image/png -o > "${tmpPath}"`,
      ]);
      const data = await readFile(tmpPath);
      await unlink(tmpPath).catch(() => {});

      if (data.length === 0) return null;
      if (data.length > MAX_ATTACHMENT_SIZE) {
        throw new Error(
          `Image too large: ${formatSize(data.length)} (max ${formatSize(MAX_ATTACHMENT_SIZE)})`,
        );
      }

      return {
        attachment: {
          type: 'image',
          mimeType: 'image/png',
          name: 'clipboard.png',
          data: data.toString('base64'),
          size: data.length,
        },
      };
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      if (err instanceof Error && err.message.startsWith('Image too large')) throw err;
      return null;
    }
  } catch {
    // xclip not available
    return null;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
