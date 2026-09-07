import JSZip from "jszip";
import type { Attachment, AttachmentKind, ChatMessage, ParsedBackup, ParsedThread, Reaction } from "./types";

export const ARCHIVE_LIMITS = {
  compressedBytes: 512 * 1024 * 1024,
  entries: 20_000,
  centralDirectoryBytes: 8 * 1024 * 1024,
  filenameBytes: 2 * 1024 * 1024,
  expandedBytes: 1024 * 1024 * 1024,
  messageFiles: 2_000,
  messageFileBytes: 16 * 1024 * 1024,
  messageJsonBytes: 128 * 1024 * 1024,
  jsonStructuralTokens: 1_000_000,
  threads: 10_000,
  participants: 20_000,
  messagesPerThread: 25_000,
  messages: 100_000,
  reactions: 500_000,
  mediaReferences: 20_000,
  mediaFiles: 5_000,
  mediaFileBytes: 100 * 1024 * 1024,
  mediaBytes: 512 * 1024 * 1024,
} as const;

type SizedZipEntry = JSZip.JSZipObject & {
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
  internalStream?: (type: "uint8array") => ZipEntryStream;
};

type ZipEntryStream = {
  on(event: "data", listener: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: "error", listener: (error: unknown) => void): ZipEntryStream;
  on(event: "end", listener: () => void): ZipEntryStream;
  pause(): ZipEntryStream;
  resume(): ZipEntryStream;
};

type ArchiveCounters = {
  messageJsonBytes: number;
  jsonStructuralTokens: number;
  participants: number;
  messages: number;
  reactions: number;
  mediaReferences: number;
};

type InstagramMessageFile = {
  participants?: Array<{ name?: string }>;
  messages?: InstagramMessage[];
  title?: string;
  is_still_participant?: boolean;
  thread_path?: string;
};

type InstagramMessage = {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  photos?: InstagramMedia[];
  videos?: InstagramMedia[];
  audio_files?: InstagramMedia[];
  files?: InstagramMedia[];
  gifs?: InstagramMedia[];
  reactions?: Array<{
    actor?: string;
    reaction?: string;
    sticker_reaction?: string;
    timestamp?: number;
  }>;
  share?: {
    link?: string;
    share_text?: string;
    original_content_owner?: string;
    profile_share_name?: string;
    profile_share_username?: string;
  };
  call_duration?: number;
};

type InstagramMedia = {
  uri?: string;
  creation_timestamp?: number;
};

const messagePathPattern =
  /^your_instagram_activity\/messages\/(?:inbox|archived_threads|filtered_threads|message_requests)\/([^/]+)\/message_\d+\.json$/i;

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"]);
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".3gp", ".avi", ".webm"]);
const audioExtensions = new Set([".opus", ".ogg", ".mp3", ".m4a", ".aac", ".wav", ".amr"]);

export async function parseInstagramBackup(file: File): Promise<ParsedBackup> {
  assertLimit(file.size, ARCHIVE_LIMITS.compressedBytes, "ZIP file size");
  await inspectZipDirectory(file);

  const zip = await JSZip.loadAsync(file);
  const allEntries = Object.values(zip.files);
  if (allEntries.length > ARCHIVE_LIMITS.entries) {
    throw new Error(`This ZIP contains too many entries. The safe limit is ${ARCHIVE_LIMITS.entries.toLocaleString()}.`);
  }

  const filenameBytes = allEntries.reduce((total, entry) => total + entry.name.length * 2, 0);
  assertLimit(filenameBytes, ARCHIVE_LIMITS.filenameBytes, "ZIP filename data");

  const entries = allEntries.filter((entry) => !entry.dir);
  const declaredSizes = new Map<string, number>();
  let declaredExpandedBytes = 0;
  for (const entry of entries) {
    const size = getDeclaredUncompressedSize(entry);
    declaredSizes.set(entry.name, size);
    declaredExpandedBytes += size;
    assertLimit(declaredExpandedBytes, ARCHIVE_LIMITS.expandedBytes, "expanded ZIP data");
  }

  const messageEntries = entries
    .filter((entry) => messagePathPattern.test(normalizePath(entry.name)))
    .sort((a, b) => normalizePath(a.name).localeCompare(normalizePath(b.name), undefined, { numeric: true }));

  if (!messageEntries.length) {
    throw new Error("No Instagram message JSON files were found in this ZIP.");
  }
  if (messageEntries.length > ARCHIVE_LIMITS.messageFiles) {
    throw new Error(
      `This ZIP contains too many message files. The safe limit is ${ARCHIVE_LIMITS.messageFiles.toLocaleString()}.`,
    );
  }

  const threadsByPath = new Map<string, InstagramMessageFile[]>();
  const counters: ArchiveCounters = {
    messageJsonBytes: 0,
    jsonStructuralTokens: 0,
    participants: 0,
    messages: 0,
    reactions: 0,
    mediaReferences: 0,
  };
  const createdUrls: string[] = [];

  try {
    for (const entry of messageEntries) {
      const declaredSize = declaredSizes.get(entry.name) ?? getDeclaredUncompressedSize(entry);
      assertLimit(declaredSize, ARCHIVE_LIMITS.messageFileBytes, "message file size");
      assertLimit(
        counters.messageJsonBytes + declaredSize,
        ARCHIVE_LIMITS.messageJsonBytes,
        "total message JSON size",
      );

      const bytes = await readEntryBytes(
        entry,
        Math.min(
          ARCHIVE_LIMITS.messageFileBytes,
          ARCHIVE_LIMITS.messageJsonBytes - counters.messageJsonBytes,
        ),
        "message file",
      );
      counters.messageJsonBytes += bytes.byteLength;
      counters.jsonStructuralTokens += countJsonStructuralTokens(bytes);
      assertLimit(counters.jsonStructuralTokens, ARCHIVE_LIMITS.jsonStructuralTokens, "JSON structure count");
      const parsed = parseMessageFile(new TextDecoder().decode(bytes), entry.name, counters);
      const threadPath = normalizePath(parsed.thread_path || getThreadPath(entry.name));
      const collection = threadsByPath.get(threadPath) ?? [];
      collection.push(parsed);
      threadsByPath.set(threadPath, collection);
      if (threadsByPath.size > ARCHIVE_LIMITS.threads) {
        throw new Error(`This ZIP contains too many chats. The safe limit is ${ARCHIVE_LIMITS.threads.toLocaleString()}.`);
      }
    }

    const threads = Array.from(threadsByPath.entries()).map(([threadPath, files], index) =>
      parseThread(threadPath, files, index),
    );
    for (const thread of threads) {
      if (thread.messages.length > ARCHIVE_LIMITS.messagesPerThread) {
        throw new Error(
          `A chat contains too many messages. The safe per-chat limit is ${ARCHIVE_LIMITS.messagesPerThread.toLocaleString()}.`,
        );
      }
    }

    const mediaPaths = Array.from(
      new Set(threads.flatMap((thread) => thread.messages.flatMap((message) => message.attachments.map(({ path }) => path)))),
    );
    if (mediaPaths.length > ARCHIVE_LIMITS.mediaFiles) {
      throw new Error(`This ZIP references too many media files. The safe limit is ${ARCHIVE_LIMITS.mediaFiles.toLocaleString()}.`);
    }

    const existingMedia = mediaPaths
      .map((path) => ({ path, entry: zip.file(path) }))
      .filter((item): item is { path: string; entry: JSZip.JSZipObject } => Boolean(item.entry));
    let declaredMediaBytes = 0;
    for (const { entry } of existingMedia) {
      const declaredSize = getDeclaredUncompressedSize(entry);
      assertLimit(declaredSize, ARCHIVE_LIMITS.mediaFileBytes, "media file size");
      declaredMediaBytes += declaredSize;
      assertLimit(declaredMediaBytes, ARCHIVE_LIMITS.mediaBytes, "total media size");
    }

    const attachments: Attachment[] = [];
    let actualMediaBytes = 0;
    for (const { path, entry } of existingMedia) {
      const bytes = await readEntryBytes(
        entry,
        Math.min(ARCHIVE_LIMITS.mediaFileBytes, ARCHIVE_LIMITS.mediaBytes - actualMediaBytes),
        "media file",
      );
      actualMediaBytes += bytes.byteLength;
      const mime = getMimeType(path, "");
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      attachments.push({
        name: getBaseName(path),
        path,
        url,
        mime,
        kind: getAttachmentKind(path, mime),
        size: bytes.byteLength,
      });
    }

    const attachmentByPath = new Map(attachments.map((attachment) => [attachment.path, attachment]));
    for (const thread of threads) {
      for (const message of thread.messages) {
        message.attachments = message.attachments
          .map((attachment) => attachmentByPath.get(attachment.path))
          .filter((attachment): attachment is Attachment => Boolean(attachment));
      }
      thread.attachments = Array.from(
        new Map(thread.messages.flatMap((message) => message.attachments).map((attachment) => [attachment.path, attachment])).values(),
      );
    }

    const sortedThreads = threads.sort((a, b) => {
      const aTime = newestTimestamp(a);
      const bTime = newestTimestamp(b);
      return bTime - aTime || b.messages.length - a.messages.length || a.title.localeCompare(b.title);
    });

    const messages = sortedThreads.flatMap((thread) => thread.messages);
    const participants = Array.from(new Set(sortedThreads.flatMap((thread) => thread.participants))).sort((a, b) =>
      a.localeCompare(b),
    );

    return {
      sourceName: file.name,
      importedAt: new Date(),
      threads: sortedThreads,
      participants,
      attachments,
      messages,
    };
  } catch (error) {
    createdUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

async function inspectZipDirectory(file: File) {
  const minimumRecordBytes = 22;
  const maximumCommentBytes = 65_535;
  const tailStart = Math.max(0, file.size - minimumRecordBytes - maximumCommentBytes);
  const tail = await readArchiveBytes(file, tailStart, file.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let endOffset = -1;

  for (let offset = tail.byteLength - minimumRecordBytes; offset >= 0; offset--) {
    if (tailView.getUint32(offset, true) !== 0x06054b50) continue;
    const commentBytes = tailView.getUint16(offset + 20, true);
    if (offset + minimumRecordBytes + commentBytes === tail.byteLength) {
      endOffset = offset;
      break;
    }
  }

  if (endOffset < 0) {
    throw new Error("This file does not contain a valid ZIP directory.");
  }

  const diskNumber = tailView.getUint16(endOffset + 4, true);
  const directoryDisk = tailView.getUint16(endOffset + 6, true);
  const entriesOnDisk = tailView.getUint16(endOffset + 8, true);
  const entryCount = tailView.getUint16(endOffset + 10, true);
  const directoryBytes = tailView.getUint32(endOffset + 12, true);
  const directoryOffset = tailView.getUint32(endOffset + 16, true);

  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    directoryBytes === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("Multi-volume and ZIP64 archives are not supported by this local viewer.");
  }

  assertLimit(entryCount, ARCHIVE_LIMITS.entries, "ZIP entry count");
  assertLimit(directoryBytes, ARCHIVE_LIMITS.centralDirectoryBytes, "ZIP directory size");
  const absoluteEndOffset = tailStart + endOffset;
  if (directoryOffset + directoryBytes > absoluteEndOffset) {
    throw new Error("This ZIP has an invalid central directory.");
  }

  const directory = await readArchiveBytes(file, directoryOffset, directoryOffset + directoryBytes);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  let offset = 0;
  let parsedEntries = 0;
  let filenameBytes = 0;
  let expandedBytes = 0;

  while (offset < directory.byteLength) {
    if (offset + 46 > directory.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("This ZIP has an invalid central-directory entry.");
    }
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      startDisk !== 0
    ) {
      throw new Error("Multi-volume and ZIP64 archives are not supported by this local viewer.");
    }

    parsedEntries += 1;
    assertLimit(parsedEntries, ARCHIVE_LIMITS.entries, "ZIP entry count");
    filenameBytes += nameBytes;
    expandedBytes += uncompressedBytes;
    assertLimit(filenameBytes, ARCHIVE_LIMITS.filenameBytes, "ZIP filename data");
    assertLimit(expandedBytes, ARCHIVE_LIMITS.expandedBytes, "expanded ZIP data");
    offset += 46 + nameBytes + extraBytes + commentBytes;
    if (offset > directory.byteLength) {
      throw new Error("This ZIP has a truncated central directory.");
    }
  }
  if (parsedEntries !== entryCount) {
    throw new Error("This ZIP has an inconsistent central-directory entry count.");
  }
}

async function readArchiveBytes(file: File, start: number, end: number): Promise<Uint8Array> {
  const source = file as File | Uint8Array;
  if (source instanceof Uint8Array) {
    return source.slice(start, end);
  }
  const segment = file.slice(start, end);
  return new Uint8Array(await segment.arrayBuffer());
}

function countJsonStructuralTokens(bytes: Uint8Array): number {
  let tokens = 0;
  let insideString = false;
  let escaped = false;
  for (const byte of bytes) {
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        escaped = true;
      } else if (byte === 0x22) {
        insideString = false;
      }
      continue;
    }
    if (byte === 0x22) {
      insideString = true;
    } else if (byte === 0x7b || byte === 0x7d || byte === 0x5b || byte === 0x5d || byte === 0x2c || byte === 0x3a) {
      tokens += 1;
    }
  }
  return tokens;
}

function parseMessageFile(json: string, entryName: string, counters: ArchiveCounters): InstagramMessageFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`Could not read message data from ${getBaseName(entryName)}.`);
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid message data in ${getBaseName(entryName)}.`);
  }

  assertOptionalArray(value.participants, "participants", entryName);
  assertOptionalArray(value.messages, "messages", entryName);
  const participants = (value.participants ?? []) as unknown[];
  const messages = (value.messages ?? []) as unknown[];
  let reactions = 0;
  let mediaReferences = 0;

  for (const participant of participants) {
    if (!isRecord(participant) || (participant.name !== undefined && typeof participant.name !== "string")) {
      throw new Error(`Invalid participant data in ${getBaseName(entryName)}.`);
    }
  }

  for (const message of messages) {
    if (!isRecord(message)) {
      throw new Error(`Invalid message data in ${getBaseName(entryName)}.`);
    }
    for (const field of ["photos", "videos", "audio_files", "files", "gifs", "reactions"] as const) {
      assertOptionalArray(message[field], field, entryName);
    }
    for (const field of ["photos", "videos", "audio_files", "files", "gifs"] as const) {
      for (const media of (message[field] ?? []) as unknown[]) {
        if (!isRecord(media) || (media.uri !== undefined && typeof media.uri !== "string")) {
          throw new Error(`Invalid ${field} data in ${getBaseName(entryName)}.`);
        }
      }
    }
    for (const reaction of (message.reactions ?? []) as unknown[]) {
      if (!isRecord(reaction)) {
        throw new Error(`Invalid reactions data in ${getBaseName(entryName)}.`);
      }
    }
    reactions += Array.isArray(message.reactions) ? message.reactions.length : 0;
    for (const items of [message.photos, message.videos, message.audio_files, message.files, message.gifs]) {
      mediaReferences += Array.isArray(items) ? items.length : 0;
    }
  }

  counters.participants += participants.length;
  counters.messages += messages.length;
  counters.reactions += reactions;
  counters.mediaReferences += mediaReferences;
  assertLimit(counters.participants, ARCHIVE_LIMITS.participants, "participant count");
  assertLimit(counters.messages, ARCHIVE_LIMITS.messages, "message count");
  assertLimit(counters.reactions, ARCHIVE_LIMITS.reactions, "reaction count");
  assertLimit(counters.mediaReferences, ARCHIVE_LIMITS.mediaReferences, "media reference count");
  return value as InstagramMessageFile;
}

function assertOptionalArray(value: unknown, field: string, entryName: string): asserts value is unknown[] | undefined {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`Invalid ${field} data in ${getBaseName(entryName)}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDeclaredUncompressedSize(entry: JSZip.JSZipObject): number {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize;
  if (size === undefined) return 0;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("This ZIP does not provide trustworthy entry-size metadata.");
  }
  return size;
}

function readEntryBytes(entry: JSZip.JSZipObject, maxBytes: number, label: string): Promise<Uint8Array> {
  const stream = (entry as SizedZipEntry).internalStream?.("uint8array");
  if (!stream) {
    return Promise.reject(new Error("This ZIP cannot be read with bounded streaming."));
  }

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error instanceof Error ? error : new Error(`Could not read ${label}.`));
    };

    stream
      .on("data", (chunk) => {
        if (settled) return;
        total += chunk.byteLength;
        if (total > maxBytes) {
          fail(new Error(`This ZIP exceeds the safe ${label} limit.`));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", fail)
      .on("end", () => {
        if (settled) return;
        settled = true;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(result);
      })
      .resume();
  });
}

function assertLimit(value: number, limit: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`This ZIP has an invalid ${label}.`);
  }
  if (value > limit) {
    throw new Error(`This ZIP exceeds the safe ${label} limit (${formatLimit(limit)}).`);
  }
}

function formatLimit(limit: number): string {
  if (limit >= 1024 * 1024) return `${Math.round(limit / (1024 * 1024))} MB`;
  return limit.toLocaleString();
}

function parseThread(
  threadPath: string,
  files: InstagramMessageFile[],
  index: number,
): ParsedThread {
  const participants = Array.from(
    new Set(files.flatMap((file) => file.participants ?? []).map((participant) => fixInstagramText(participant.name ?? ""))),
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const rawMessages = files.flatMap((file) => file.messages ?? []);
  const messages = rawMessages
    .map((message, messageIndex) => buildMessage(message, threadPath, messageIndex))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));

  const title = fixInstagramText(files.find((file) => file.title)?.title ?? participants.join(", ") ?? `Thread ${index + 1}`);

  return {
    id: threadPath || `thread-${index}`,
    title,
    path: threadPath,
    messages,
    participants,
    attachments: [],
    isStillParticipant: files.some((file) => file.is_still_participant),
  };
}

function buildMessage(message: InstagramMessage, threadPath: string, index: number): ChatMessage {
  const timestamp = typeof message.timestamp_ms === "number" ? new Date(message.timestamp_ms) : null;
  const mediaRefs = [
    ...(message.photos ?? []),
    ...(message.videos ?? []),
    ...(message.audio_files ?? []),
    ...(message.files ?? []),
    ...(message.gifs ?? []),
  ];
  const attachments = mediaRefs
    .map((media) => normalizePath(media.uri ?? ""))
    .filter(Boolean)
    .map((path) => placeholderAttachment(path));

  const textParts = [
    fixInstagramText(message.content ?? ""),
    formatShareText(message.share),
    formatCallText(message.call_duration),
  ].filter(Boolean);

  return {
    id: `${threadPath}-${message.timestamp_ms ?? "unknown"}-${index}`,
    timestamp,
    sender: fixInstagramText(message.sender_name ?? ""),
    text: textParts.join("\n"),
    isSystem: !message.sender_name,
    attachments,
    reactions: parseReactions(message.reactions),
    shareUrl: getSafeExternalUrl(message.share?.link),
  };
}

function parseReactions(reactions?: InstagramMessage["reactions"]): Reaction[] {
  return (reactions ?? []).map((reaction) => ({
    actor: fixInstagramText(reaction.actor ?? ""),
    reaction: fixInstagramText(reaction.reaction || reaction.sticker_reaction || ""),
    timestamp: typeof reaction.timestamp === "number" ? new Date(reaction.timestamp * 1000) : null,
  }));
}

function formatShareText(share?: InstagramMessage["share"]): string {
  if (!share) return "";
  return [share.share_text, share.profile_share_name, share.profile_share_username, share.original_content_owner, share.link]
    .map((part) => fixInstagramText(part ?? ""))
    .filter(Boolean)
    .join("\n");
}

function formatCallText(callDuration?: number): string {
  if (typeof callDuration !== "number") return "";
  if (callDuration <= 0) return "Call ended";
  const minutes = Math.floor(callDuration / 60);
  const seconds = callDuration % 60;
  return `Call duration ${minutes}:${String(seconds).padStart(2, "0")}`;
}

function placeholderAttachment(path: string): Attachment {
  const mime = getMimeType(path, "");
  return {
    name: getBaseName(path),
    path,
    url: "",
    mime,
    kind: getAttachmentKind(path, mime),
    size: 0,
  };
}

export function revokeBackupUrls(backup: ParsedBackup | null) {
  backup?.attachments.forEach((attachment) => URL.revokeObjectURL(attachment.url));
}

function newestTimestamp(thread: ParsedThread): number {
  let newest = 0;
  for (const message of thread.messages) {
    newest = Math.max(newest, message.timestamp?.getTime() ?? 0);
  }
  return newest;
}

function getSafeExternalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function getThreadPath(path: string): string {
  const normalized = normalizePath(path);
  const match = normalized.match(messagePathPattern);
  return match ? normalized.slice(0, normalized.indexOf(`/message_`)) : normalized;
}

function getAttachmentKind(path: string, mime: string): AttachmentKind {
  const extension = getExtension(path);
  if (mime.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (mime.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (mime.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  if (extension) return "document";
  return "unknown";
}

function getMimeType(path: string, fallback: string): string {
  const extension = getExtension(path);
  const known: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".3gp": "video/3gpp",
    ".webm": "video/webm",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".amr": "audio/amr",
    ".pdf": "application/pdf",
  };
  return known[extension] ?? fallback ?? "application/octet-stream";
}

function getExtension(path: string): string {
  const name = getBaseName(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function getBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function fixInstagramText(value: string): string {
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}
