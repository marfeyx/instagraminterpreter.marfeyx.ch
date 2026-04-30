export type AttachmentKind = "image" | "video" | "audio" | "document" | "unknown";

export type Attachment = {
  name: string;
  path: string;
  url: string;
  mime: string;
  kind: AttachmentKind;
  size: number;
};

export type Reaction = {
  actor: string;
  reaction: string;
  timestamp: Date | null;
};

export type ChatMessage = {
  id: string;
  timestamp: Date | null;
  sender: string | null;
  text: string;
  isSystem: boolean;
  attachments: Attachment[];
  reactions: Reaction[];
  shareUrl?: string;
};

export type ParsedThread = {
  id: string;
  title: string;
  path: string;
  messages: ChatMessage[];
  participants: string[];
  attachments: Attachment[];
  isStillParticipant: boolean;
};

export type ParsedBackup = {
  sourceName: string;
  importedAt: Date;
  threads: ParsedThread[];
  participants: string[];
  attachments: Attachment[];
  messages: ChatMessage[];
};

export type MessageFilter = "all" | "text" | "images" | "videos" | "audio" | "shares" | "reactions";
