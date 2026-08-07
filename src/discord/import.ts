import { buildFitDraft } from '../fits/assignment.ts';
import { extractEftBlocksFromText } from '../fits/eft-blocks.ts';
import {
  renderPyfaExtractionToEft,
  type PyfaScreenshotExtractor,
} from '../fits/pyfa-image-import.ts';
import type { AsyncFitStore, FitStore, LibraryVisibility, SavedFitDetail, SavedFitSummary } from '../fits/store.ts';
import type { FitDraft } from '../fits/types.ts';

export const DISCORD_MESSAGE_LIMIT = 100;
export const DISCORD_IMAGE_SCAN_LIMIT = 10;

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const TEXT_CHANNEL_TYPES = new Set([0, 5, 15, 16]);
const ARCHIVED_THREAD_PARENT_TYPES = new Set([15, 16]);
const THREAD_TYPES = new Set([10, 11, 12]);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface DiscordChannel {
  id: string;
  name?: string | null;
  type: number;
  parent_id?: string | null;
  guild_id?: string;
}

export interface DiscordAttachment {
  id: string;
  url: string;
  filename: string;
  content_type?: string | null;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  timestamp: string;
  author: { id: string; username?: string; global_name?: string | null };
  attachments?: DiscordAttachment[];
}

export interface DiscordApiClient {
  listGuildChannels(): Promise<DiscordChannel[]>;
  listActiveThreads(): Promise<DiscordChannel[]>;
  listPublicArchivedThreads(channelId: string): Promise<DiscordChannel[]>;
  joinThread?(channelId: string): Promise<void>;
  fetchMessages(channelId: string, limit: number): Promise<DiscordMessage[]>;
  fetchAttachmentBase64(attachment: DiscordAttachment): Promise<string>;
}

export interface DiscordImportChannel {
  id: string;
  label: string;
  type: 'channel' | 'thread';
  parentId: string | null;
  parentName: string | null;
}

export interface DiscordImportSource {
  channelLabel: string;
  authorName: string;
  timestamp: string;
  messageUrl: string;
}

export type DiscordImportDefaultAction =
  | { kind: 'create' }
  | { kind: 'update'; fitId: number }
  | { kind: 'skip'; reason: string };

export interface DiscordImportFitCandidate {
  id: string;
  rawEft: string;
  fitName: string;
  shipName: string;
  shipTypeId: number | null;
  sourceType: 'eft-text' | 'pyfa-image';
  warnings: string[];
  defaultAction: DiscordImportDefaultAction;
}

export interface DiscordImportMessageGroup {
  message: {
    id: string;
    authorName: string;
    timestamp: string;
    url: string;
    excerpt: string;
  };
  fits: DiscordImportFitCandidate[];
  warnings: string[];
}

export interface DiscordImportScanResult {
  channelId: string;
  channelLabel: string;
  scannedMessages: number;
  warnings: string[];
  diagnostics: string[];
  summary: {
    fitsFound: number;
    imagesFound: number;
    imagesScanned: number;
    imagesSkipped: number;
  };
  groups: DiscordImportMessageGroup[];
}

export interface DiscordImportScanInput {
  channelId: string;
  channelLabel: string;
  channelType?: DiscordImportChannel['type'];
  includeImages?: boolean;
  visibility: LibraryVisibility;
  ownerUserId: string;
}

export type DiscordImportApplyAction =
  | {
      action: 'create';
      rawEft: string;
      fitName: string;
      source: DiscordImportSource;
    }
  | {
      action: 'update';
      fitId: number;
      rawEft: string;
      fitName: string;
      source: DiscordImportSource;
    }
  | {
      action: 'skip';
      rawEft: string;
      fitName: string;
      source: DiscordImportSource;
    };

export interface DiscordImportApplyInput {
  ownerUserId: string;
  visibility: LibraryVisibility;
  actions: DiscordImportApplyAction[];
}

export interface DiscordImportApplyResult {
  created: Array<{ fitId: number; fitName: string; shipName: string }>;
  updated: Array<{ fitId: number; fitName: string; shipName: string }>;
  skipped: Array<{ fitName: string; reason: string }>;
  failed: Array<{ fitName: string; error: string }>;
}

export interface DiscordImportService {
  listChannels(): Promise<DiscordImportChannel[]>;
  scan(input: DiscordImportScanInput): Promise<DiscordImportScanResult>;
  apply(input: DiscordImportApplyInput): Promise<DiscordImportApplyResult>;
}

interface DiscordImportServiceDeps {
  api: DiscordApiClient;
  fitStore: FitStore | AsyncFitStore;
  buildDraft?: typeof buildFitDraft;
  pyfaExtractor?: PyfaScreenshotExtractor;
}

export function createDiscordImportService(deps: DiscordImportServiceDeps): DiscordImportService {
  const buildDraft = deps.buildDraft ?? buildFitDraft;

  return {
    async listChannels() {
      const channels = await deps.api.listGuildChannels();
      const readableChannels = channels.filter(channel => TEXT_CHANNEL_TYPES.has(channel.type) && channel.name);
      const parentNames = new Map(readableChannels.map(channel => [channel.id, channel.name ?? channel.id]));
      const activeThreads = await deps.api.listActiveThreads();
      const archivedThreads = await listArchivedThreads(deps.api, readableChannels);
      const threadMap = new Map<string, DiscordChannel>();
      for (const thread of [...activeThreads, ...archivedThreads]) {
        if (THREAD_TYPES.has(thread.type) && thread.name) threadMap.set(thread.id, thread);
      }

      const rows: DiscordImportChannel[] = [
        ...readableChannels.map(channel => ({
          id: channel.id,
          label: channel.name ?? channel.id,
          type: 'channel' as const,
          parentId: null,
          parentName: null,
        })),
        ...[...threadMap.values()].map(thread => {
          const parentName = thread.parent_id ? parentNames.get(thread.parent_id) ?? null : null;
          return {
            id: thread.id,
            label: parentName ? `${parentName} / ${thread.name}` : thread.name ?? thread.id,
            type: 'thread' as const,
            parentId: thread.parent_id ?? null,
            parentName,
          };
        }),
      ];

      rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      return filterScannableChannels(deps.api, rows);
    },

    async scan(input) {
      const joinStatus = input.channelType === 'thread'
        ? await tryJoinThread(deps.api, input.channelId)
        : null;
      const diagnostics: string[] = [
        `Selected target: ${input.channelType ?? 'channel'} "${input.channelLabel}" (${input.channelId})`,
        `Requested message limit: ${DISCORD_MESSAGE_LIMIT}`,
        `Screenshot scan: ${input.includeImages ? 'enabled' : 'disabled'}`,
      ];
      if (input.channelType === 'thread') diagnostics.push(threadJoinDiagnostic(joinStatus));
      else diagnostics.push('Thread join: not attempted for non-thread target.');

      const messages = await deps.api.fetchMessages(input.channelId, DISCORD_MESSAGE_LIMIT);
      const existing = await visibleFits(deps.fitStore, input.visibility, input.ownerUserId);
      const groups: DiscordImportMessageGroup[] = [];
      const scanWarnings: string[] = [];
      let imagesFound = 0;
      let imagesScanned = 0;
      let imagesSkipped = 0;
      let textBlocksFound = 0;
      const messagesWithContent = messages.filter(message => message.content.trim().length > 0).length;
      const attachmentCount = messages.reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0);
      const imageAttachmentCount = messages.reduce(
        (sum, message) => sum + (message.attachments ?? []).filter(isImageAttachment).length,
        0,
      );
      diagnostics.push(`Discord messages returned: ${messages.length}`);
      diagnostics.push(`Messages with non-empty content: ${messagesWithContent}/${messages.length}`);
      diagnostics.push(`Attachments returned: ${attachmentCount} total, ${imageAttachmentCount} supported images`);
      const timestampRange = messageTimestampRange(messages);
      if (timestampRange) diagnostics.push(`Message timestamp range: ${timestampRange}`);

      if (messages.length === 0) {
        scanWarnings.push(zeroMessageWarning(input.channelType, joinStatus));
      } else if (messagesWithContent === 0) {
        scanWarnings.push('Discord returned messages, but every message had empty text content. Message Content Intent may be disabled, or Discord may be hiding content from this bot.');
      }

      for (const message of messages) {
        const source = sourceForMessage(message, input.channelLabel);
        const group: DiscordImportMessageGroup = {
          message: {
            id: message.id,
            authorName: source.authorName,
            timestamp: message.timestamp,
            url: source.messageUrl,
            excerpt: excerpt(message.content),
          },
          fits: [],
          warnings: [],
        };

        const textBlocks = extractEftBlocksFromText(message.content);
        textBlocksFound += textBlocks.length;
        textBlocks.forEach((block, index) => {
          const candidate = candidateFromRawEft({
            id: `${message.id}:text:${index}`,
            rawEft: block.rawEft,
            sourceType: 'eft-text',
            buildDraft,
            existing,
          });
          group.fits.push(candidate);
        });

        for (const attachment of message.attachments ?? []) {
          if (!isImageAttachment(attachment)) continue;
          imagesFound++;
          if (!input.includeImages) {
            imagesSkipped++;
            continue;
          }
          if (imagesScanned >= DISCORD_IMAGE_SCAN_LIMIT) {
            imagesSkipped++;
            continue;
          }
          imagesScanned++;
          if (!deps.pyfaExtractor) {
            group.warnings.push(`${attachment.filename} skipped: Pyfa screenshot import is not configured.`);
            continue;
          }
          try {
            const imageBase64 = await deps.api.fetchAttachmentBase64(attachment);
            const extraction = await deps.pyfaExtractor.extract({
              imageBase64,
              mimeType: mimeTypeForAttachment(attachment),
              userId: input.ownerUserId,
            });
            const rendered = renderPyfaExtractionToEft(extraction);
            const candidate = candidateFromRawEft({
              id: `${message.id}:image:${attachment.id}`,
              rawEft: rendered.rawEft,
              sourceType: 'pyfa-image',
              buildDraft,
              existing,
              extraWarnings: rendered.warnings,
            });
            group.fits.push(candidate);
          } catch (err) {
            group.warnings.push(`${attachment.filename} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        if (group.fits.length > 0 || group.warnings.length > 0) groups.push(group);
      }

      const fitsFound = groups.reduce((sum, group) => sum + group.fits.length, 0);
      if (!input.includeImages && imagesFound > 0) {
        scanWarnings.push(`${imagesFound} image${imagesFound === 1 ? '' : 's'} skipped. Enable Scan screenshots to run pyfa image OCR.`);
      }
      diagnostics.push(`EFT text blocks detected: ${textBlocksFound}`);
      diagnostics.push(`Image scan usage: ${imagesScanned}/${imagesFound} scanned, ${imagesSkipped} skipped`);
      diagnostics.push(`Fit candidates generated: ${fitsFound}`);

      return {
        channelId: input.channelId,
        channelLabel: input.channelLabel,
        scannedMessages: messages.length,
        warnings: scanWarnings,
        diagnostics,
        summary: {
          fitsFound,
          imagesFound,
          imagesScanned,
          imagesSkipped,
        },
        groups,
      };
    },

    async apply(input) {
      const result: DiscordImportApplyResult = { created: [], updated: [], skipped: [], failed: [] };
      for (const action of input.actions) {
        if (action.action === 'skip') {
          result.skipped.push({ fitName: action.fitName, reason: 'Skipped by user.' });
          continue;
        }
        try {
          const draft = buildDraft(action.rawEft);
          if (!draft.ship) throw new Error('Fit hull could not be resolved.');
          const notes = appendDiscordSourceNote(
            action.action === 'update' ? (await deps.fitStore.get(action.fitId))?.notes ?? '' : '',
            action.source,
          );
          const saved = action.action === 'create'
            ? await deps.fitStore.create({
                rawEft: action.rawEft,
                shipTypeId: draft.ship.typeId,
                fitName: action.fitName,
                notes,
                ownerUserId: input.ownerUserId,
                visibility: input.visibility,
              })
            : await deps.fitStore.update(action.fitId, {
                rawEft: action.rawEft,
                shipTypeId: draft.ship.typeId,
                fitName: action.fitName,
                notes,
              });
          if (!saved?.ship) throw new Error('Saved fit could not be loaded.');
          const entry = { fitId: saved.id, fitName: saved.fitName, shipName: saved.ship.name };
          if (action.action === 'create') result.created.push(entry);
          else result.updated.push(entry);
        } catch (err) {
          result.failed.push({ fitName: action.fitName, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return result;
    },
  };
}

export function createDiscordApiClient(input: { botToken?: string; guildId?: string; fetchImpl?: typeof fetch }): DiscordApiClient {
  const token = input.botToken?.trim();
  const guildId = input.guildId?.trim();
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is required.');
  if (!guildId) throw new Error('DISCORD_GUILD_ID is required.');

  async function discordFetch<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${DISCORD_API_BASE}${path}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) throw new Error(await discordApiError(res, 'GET', path));
    return res.json() as Promise<T>;
  }

  return {
    listGuildChannels: () => discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
    async listActiveThreads() {
      const body = await discordFetch<{ threads?: DiscordChannel[] }>(`/guilds/${guildId}/threads/active`);
      return body.threads ?? [];
    },
    async listPublicArchivedThreads(channelId) {
      const body = await discordFetch<{ threads?: DiscordChannel[] }>(`/channels/${channelId}/threads/archived/public?limit=100`);
      return body.threads ?? [];
    },
    async joinThread(channelId) {
      const res = await fetchImpl(`${DISCORD_API_BASE}/channels/${channelId}/thread-members/@me`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${token}` },
      });
      if (!res.ok) {
        throw new Error(await discordApiError(res, 'PUT', `/channels/${channelId}/thread-members/@me`));
      }
    },
    fetchMessages: (channelId, limit) => discordFetch<DiscordMessage[]>(`/channels/${channelId}/messages?limit=${Math.min(DISCORD_MESSAGE_LIMIT, Math.max(1, limit))}`),
    async fetchAttachmentBase64(attachment) {
      const res = await fetchImpl(attachment.url, { headers: { Authorization: `Bot ${token}` } });
      if (!res.ok) throw new Error(await discordApiError(res, 'GET', `attachment ${attachment.filename}`));
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
    },
  };
}

type ThreadJoinStatus = 'joined' | { error: string };

async function tryJoinThread(api: DiscordApiClient, channelId: string): Promise<ThreadJoinStatus> {
  if (!api.joinThread) return { error: 'Discord thread join is not configured.' };
  try {
    await api.joinThread(channelId);
    return 'joined';
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function zeroMessageWarning(channelType: DiscordImportChannel['type'] | undefined, joinStatus: ThreadJoinStatus | null): string {
  const parts = [
    'Discord returned 0 messages.',
    'Confirm the selected entry is the actual forum post/thread containing fits, not only the parent forum channel.',
    'The bot needs View Channel and Read Message History on that exact thread.',
  ];
  if (channelType === 'thread') {
    if (joinStatus === 'joined') {
      parts.push('The bot successfully joined the selected thread before scanning.');
    } else if (joinStatus) {
      parts.push(`The bot could not join the selected thread before scanning: ${joinStatus.error}. It may need Send Messages in Threads or explicit access to the thread.`);
    } else {
      parts.push('The selected entry is a thread, but no thread join was attempted.');
    }
  }
  parts.push('Message Content Intent is still required for EFT text imports once messages are returned.');
  return parts.join(' ');
}

function threadJoinDiagnostic(joinStatus: ThreadJoinStatus | null): string {
  if (joinStatus === 'joined') return 'Thread join: succeeded.';
  if (joinStatus) return `Thread join: failed (${joinStatus.error}).`;
  return 'Thread join: not attempted.';
}

function messageTimestampRange(messages: DiscordMessage[]): string | null {
  const times = messages
    .map(message => Date.parse(message.timestamp))
    .filter(time => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const first = new Date(times[0]).toISOString();
  const last = new Date(times[times.length - 1]).toISOString();
  return first === last ? first : `${first} to ${last}`;
}

async function discordApiError(res: Response, method: string, target: string): Promise<string> {
  const bodyText = await res.text().catch(() => '');
  const details = discordErrorDetails(bodyText);
  return `Discord API request failed with ${res.status} on ${method} ${target}${details ? ` (${details})` : ''}`;
}

function discordErrorDetails(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; message?: unknown };
    const code = typeof parsed.code === 'number' || typeof parsed.code === 'string' ? `code ${parsed.code}` : '';
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    return [code, message].filter(Boolean).join(': ').slice(0, 240);
  } catch {
    return trimmed.slice(0, 240);
  }
}

async function listArchivedThreads(api: DiscordApiClient, channels: DiscordChannel[]): Promise<DiscordChannel[]> {
  const threadParentChannels = channels.filter(channel => ARCHIVED_THREAD_PARENT_TYPES.has(channel.type));
  const nested = await Promise.all(threadParentChannels.map(async channel => {
    try {
      return await api.listPublicArchivedThreads(channel.id);
    } catch {
      return [];
    }
  }));
  return nested.flat();
}

async function filterScannableChannels(api: DiscordApiClient, rows: DiscordImportChannel[]): Promise<DiscordImportChannel[]> {
  const checks = await mapWithConcurrency(rows, 6, async row => {
    try {
      await api.fetchMessages(row.id, 1);
      return { row, canScan: true };
    } catch {
      return { row, canScan: false };
    }
  });
  return checks.filter(check => check.canScan).map(check => check.row);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function visibleFits(store: FitStore | AsyncFitStore, visibility: LibraryVisibility, ownerUserId: string): Promise<SavedFitSummary[]> {
  return visibility === 'public'
    ? await store.list({ visibility: 'public' })
    : await store.list({ visibility: 'private', ownerUserId });
}

function candidateFromRawEft(input: {
  id: string;
  rawEft: string;
  sourceType: 'eft-text' | 'pyfa-image';
  buildDraft: typeof buildFitDraft;
  existing: SavedFitSummary[];
  extraWarnings?: string[];
}): DiscordImportFitCandidate {
  try {
    const draft = input.buildDraft(input.rawEft);
    const warnings = [
      ...draft.warnings.map(warning => warning.message),
      ...(input.extraWarnings ?? []),
    ];
    return {
      id: input.id,
      rawEft: input.rawEft,
      fitName: draft.fitName,
      shipName: draft.ship?.name ?? draft.headerShipName,
      shipTypeId: draft.ship?.typeId ?? null,
      sourceType: input.sourceType,
      warnings,
      defaultAction: defaultActionFor(draft, input.existing),
    };
  } catch (err) {
    return {
      id: input.id,
      rawEft: input.rawEft,
      fitName: 'Unresolved fit',
      shipName: 'Unknown hull',
      shipTypeId: null,
      sourceType: input.sourceType,
      warnings: [err instanceof Error ? err.message : String(err)],
      defaultAction: { kind: 'skip', reason: 'Fit could not be parsed.' },
    };
  }
}

function defaultActionFor(draft: FitDraft, existing: SavedFitSummary[]): DiscordImportDefaultAction {
  if (!draft.ship) return { kind: 'skip', reason: 'Fit hull could not be resolved.' };
  const match = existing.find(fit =>
    fit.shipTypeId === draft.ship!.typeId && normalizeFitName(fit.fitName) === normalizeFitName(draft.fitName),
  );
  return match ? { kind: 'update', fitId: match.id } : { kind: 'create' };
}

function sourceForMessage(message: DiscordMessage, channelLabel: string): DiscordImportSource {
  return {
    channelLabel,
    authorName: message.author.global_name?.trim() || message.author.username || message.author.id,
    timestamp: message.timestamp,
    messageUrl: `https://discord.com/channels/${message.guild_id ?? '@me'}/${message.channel_id}/${message.id}`,
  };
}

function appendDiscordSourceNote(existingNotes: string, source: DiscordImportSource): string {
  const line = `Discord source: ${source.channelLabel} - ${source.authorName} - ${source.timestamp} - ${source.messageUrl}`;
  if (existingNotes.includes(source.messageUrl)) return existingNotes;
  return [existingNotes.trim(), line].filter(Boolean).join('\n\n');
}

function excerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function isImageAttachment(attachment: DiscordAttachment): boolean {
  if (attachment.content_type && IMAGE_MIME_TYPES.has(attachment.content_type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(attachment.filename);
}

function mimeTypeForAttachment(attachment: DiscordAttachment): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (attachment.content_type === 'image/jpeg' || attachment.content_type === 'image/webp') return attachment.content_type;
  return 'image/png';
}

function normalizeFitName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
