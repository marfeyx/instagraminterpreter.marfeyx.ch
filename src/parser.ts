import JSZip from "jszip";
import type { Attachment, AttachmentKind, ChatMessage, ParsedBackup, ParsedThread, Reaction } from "./types";

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
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const messageEntries = entries
    .filter((entry) => messagePathPattern.test(normalizePath(entry.name)))
    .sort((a, b) => normalizePath(a.name).localeCompare(normalizePath(b.name), undefined, { numeric: true }));

  if (!messageEntries.length) {
    throw new Error("No Instagram message JSON files were found in this ZIP.");
  }

  const threadsByPath = new Map<string, InstagramMessageFile[]>();

  for (const entry of messageEntries) {
    const json = await entry.async("string");
    const parsed = JSON.parse(json) as InstagramMessageFile;
    const threadPath = normalizePath(parsed.thread_path || getThreadPath(entry.name));
    const collection = threadsByPath.get(threadPath) ?? [];
    collection.push(parsed);
    threadsByPath.set(threadPath, collection);
  }

  const threads = await Promise.all(
    Array.from(threadsByPath.entries()).map(([threadPath, files], index) => parseThread(zip, threadPath, files, index)),
  );

  const sortedThreads = threads.sort((a, b) => {
    const aTime = newestTimestamp(a);
    const bTime = newestTimestamp(b);
    return bTime - aTime || b.messages.length - a.messages.length || a.title.localeCompare(b.title);
  });

  const messages = sortedThreads.flatMap((thread) => thread.messages);
  const attachments = sortedThreads.flatMap((thread) => thread.attachments);
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
}

async function parseThread(
  zip: JSZip,
  threadPath: string,
  files: InstagramMessageFile[],
  index: number,
): Promise<ParsedThread> {
  const participants = Array.from(
    new Set(files.flatMap((file) => file.participants ?? []).map((participant) => fixInstagramText(participant.name ?? ""))),
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const rawMessages = files.flatMap((file) => file.messages ?? []);
  const messages = rawMessages
    .map((message, messageIndex) => buildMessage(message, threadPath, messageIndex))
    .sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));

  const mediaPaths = new Set(messages.flatMap((message) => message.attachments.map((attachment) => attachment.path)));
  const attachments = await Promise.all(
    Array.from(mediaPaths).map(async (path) => {
      const entry = zip.file(path);
      const blob = entry ? await entry.async("blob") : new Blob();
      const mime = getMimeType(path, blob.type);
      return {
        name: getBaseName(path),
        path,
        url: URL.createObjectURL(new Blob([blob], { type: mime })),
        mime,
        kind: getAttachmentKind(path, mime),
        size: blob.size,
      } satisfies Attachment;
    }),
  );

  const attachmentByPath = new Map(attachments.map((attachment) => [attachment.path, attachment]));
  for (const message of messages) {
    message.attachments = message.attachments
      .map((attachment) => attachmentByPath.get(attachment.path))
      .filter((attachment): attachment is Attachment => Boolean(attachment));
  }

  const title = fixInstagramText(files.find((file) => file.title)?.title ?? participants.join(", ") ?? `Thread ${index + 1}`);

  return {
    id: threadPath || `thread-${index}`,
    title,
    path: threadPath,
    messages,
    participants,
    attachments,
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
    shareUrl: message.share?.link,
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
  return Math.max(...thread.messages.map((message) => message.timestamp?.getTime() ?? 0), 0);
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
