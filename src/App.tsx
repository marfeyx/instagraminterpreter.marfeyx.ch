import { Avatar as HeroAvatar, Button, Card, Chip, Meter, SearchField } from "@heroui/react";
import {
  CalendarDays,
  ExternalLink,
  FileArchive,
  FileText,
  LockKeyhole,
  MessageCircleMore,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseInstagramBackup, revokeBackupUrls } from "./parser";
import type { Attachment, ChatMessage, MessageFilter, ParsedBackup, ParsedThread } from "./types";

type ParticipantStats = {
  name: string;
  messages: number;
  words: number;
  attachments: number;
  reactions: number;
  responseCount: number;
  totalResponseMs: number;
  averageResponseMs: number | null;
};

type TimestampedParticipantMessage = ChatMessage & {
  sender: string;
  timestamp: Date;
  isSystem: false;
};

type ThreadStats = {
  participantStats: ParticipantStats[];
  totalParticipantMessages: number;
  totalParticipantWords: number;
  imageCount: number;
  shareCount: number;
  reactionCount: number;
};

const filters: Array<{ id: MessageFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "audio", label: "Audio" },
  { id: "shares", label: "Shares" },
  { id: "reactions", label: "Reactions" },
];

const maxResponseGapMs = 16 * 60 * 60 * 1000;

function App() {
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [myName, setMyName] = useState("");
  const [query, setQuery] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const [dateQuery, setDateQuery] = useState("");
  const [filter, setFilter] = useState<MessageFilter>("all");
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousBackup = useRef<ParsedBackup | null>(null);

  useEffect(() => {
    return () => revokeBackupUrls(previousBackup.current);
  }, []);

  useEffect(() => {
    previousBackup.current = backup;
  }, [backup]);

  const selectedThread = useMemo(() => {
    if (!backup) return null;
    return backup.threads.find((thread) => thread.id === selectedThreadId) ?? backup.threads[0] ?? null;
  }, [backup, selectedThreadId]);

  const visibleThreads = useMemo(() => {
    if (!backup) return [];
    const search = threadQuery.trim().toLowerCase();
    if (!search) return backup.threads;
    return backup.threads.filter(
      (thread) =>
        thread.title.toLowerCase().includes(search) ||
        thread.participants.some((participant) => participant.toLowerCase().includes(search)),
    );
  }, [backup, threadQuery]);

  const visibleMessages = useMemo(() => {
    if (!selectedThread) return [];
    const search = query.trim().toLowerCase();
    return selectedThread.messages.filter((message) => {
      if (!matchesFilter(message, filter)) return false;
      if (dateQuery && formatDateInputValue(message.timestamp) !== dateQuery) return false;
      if (!search) return true;
      return (
        message.text.toLowerCase().includes(search) ||
        (message.sender ?? "").toLowerCase().includes(search) ||
        message.attachments.some((attachment) => attachment.name.toLowerCase().includes(search)) ||
        message.reactions.some((reaction) => reaction.reaction.toLowerCase().includes(search))
      );
    });
  }, [dateQuery, filter, query, selectedThread]);

  const threadStats = useMemo(() => (selectedThread ? getThreadStats(selectedThread) : null), [selectedThread]);
  const importedAt = backup?.importedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "9:41";

  function handleUploadClick() {
    setError("");
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setError("");

    try {
      const parsed = await parseInstagramBackup(file);
      revokeBackupUrls(backup);
      setBackup(parsed);
      setSelectedThreadId(parsed.threads[0]?.id ?? "");
      setMyName(pickLikelySelf(parsed) ?? parsed.participants[0] ?? "");
      setFilter("all");
      setQuery("");
      setThreadQuery("");
      setDateQuery("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not parse this Instagram export.");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  }



  return (
    <>
      <MobileDisabled />
      <main className="app-shell">
      <section className="control-panel" aria-label="Import and chat list">
        <header className="brand-header">
          <div className="brand-mark" aria-hidden="true">
            <MessageCircleMore size={21} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <span>Archive Studio</span>
            <small>Instagram interpreter</small>
          </div>
          <Chip className="local-chip" color="success" size="sm" variant="soft">
            <span className="status-dot" aria-hidden="true" /> Local
          </Chip>
        </header>

        <div className="intro-copy">
          <p className="eyebrow">Private by design</p>
          <h1>Your conversations, made clear.</h1>
          <p>Explore years of messages, media, and patterns without anything leaving your device.</p>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".zip,application/zip"
          disabled={isParsing}
          onChange={handleFileChange}
        />
        <Button
          className="file-drop"
          variant="secondary"
          onPress={handleUploadClick}
          isDisabled={isParsing}
          isPending={isParsing}
        >
          <span className="file-icon" aria-hidden="true">
            <Upload size={20} strokeWidth={1.8} />
          </span>
          <span className="file-drop-copy">
            <strong>{isParsing ? "Reading your archive…" : backup ? "Choose another archive" : "Choose Instagram export"}</strong>
            <small>{isParsing ? "Everything stays on this device" : "ZIP archive · processed locally"}</small>
          </span>
          {!isParsing ? <span className="zip-tag">ZIP</span> : null}
        </Button>

        {error ? <p className="error-message">{error}</p> : null}

        {backup ? (
          <>
            <div className="summary-grid">
              <SummaryTile label="Chats" value={backup.threads.length.toLocaleString()} />
              <SummaryTile label="Messages" value={backup.messages.length.toLocaleString()} />
              <SummaryTile label="Files" value={backup.attachments.length.toLocaleString()} />
            </div>

            <div className="list-heading">
              <span>Conversations</span>
              <small>{visibleThreads.length.toLocaleString()}</small>
            </div>

            <SearchBox
              ariaLabel="Find a conversation"
              placeholder="Search conversations"
              value={threadQuery}
              onChange={setThreadQuery}
            />

            <ThreadList
              threads={visibleThreads}
              selectedThreadId={selectedThread?.id ?? ""}
              myName={myName}
              onSelect={(thread) => {
                setSelectedThreadId(thread.id);
                setQuery("");
                setDateQuery("");
                setFilter("all");
              }}
            />
          </>
        ) : (
          <Card className="privacy-note" variant="secondary">
            <div className="privacy-icon" aria-hidden="true">
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong>Your archive stays yours.</strong>
              <span>The ZIP is read in this browser and held in memory only. Nothing is uploaded.</span>
            </div>
          </Card>
        )}

        <footer className="site-footer">
          <div className="footer-links">
            <a href="privacy.html"><LockKeyhole size={13} /> Privacy</a>
            <a href="https://github.com/marfeyx/instagraminterpreter.marfeyx.ch/issues">
              Support <ExternalLink size={12} />
            </a>
          </div>
        </footer>
      </section>

      <section className="phone-stage" aria-label="Instagram-style chat preview">
        <div className="stage-glow" aria-hidden="true" />
        <div className={selectedThread ? "phone-frame has-thread" : "phone-frame"}>
          <div className="phone-status">
            <span className="status-time">{importedAt}</span>
            <span className="dynamic-island" aria-hidden="true" />
            <span className="status-private"><LockKeyhole size={11} /> Private</span>
          </div>

          <div className="chat-header">
            <span className="header-leading" aria-hidden="true"><MessageCircleMore size={17} /></span>
            <div className="contact-stack">
              <Avatar fallback={getInitials(getChatTitle(selectedThread, myName))} />
              <div className="chat-title">
                <strong>{getChatTitle(selectedThread, myName)}</strong>
                <span>{selectedThread ? `${selectedThread.messages.length.toLocaleString()} messages` : "Archive preview"}</span>
              </div>
            </div>
            <span className="header-action" aria-hidden="true">
              <MoreHorizontal size={19} />
            </span>
          </div>

          {selectedThread ? (
            <div className="toolbar">
              <SearchBox
                ariaLabel="Search messages"
                className="toolbar-search"
                placeholder="Search messages"
                value={query}
                onChange={setQuery}
              />
              <div className="date-control">
                <CalendarDays size={14} aria-hidden="true" />
                <input
                className="date-input"
                type="date"
                value={dateQuery}
                onChange={(event) => setDateQuery(event.target.value)}
                aria-label="Filter by date"
              />
              </div>
            </div>
          ) : null}

          <div className="message-list">
            {selectedThread ? (
              <Timeline messages={visibleMessages} myName={myName} />
            ) : (
              <div className="empty-state">
                <div className="empty-mark" aria-hidden="true">
                  <Sparkles size={25} strokeWidth={1.6} />
                </div>
                <Chip color="accent" size="sm" variant="soft">Ready when you are</Chip>
                <h2>See the story inside your archive.</h2>
                <p>Select an Instagram export to privately browse messages, media, and conversation insights.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="details-panel" aria-label="Detailed chat statistics">
        <DetailedStats
          backup={backup}
          thread={selectedThread}
          stats={threadStats}
          visibleCount={visibleMessages.length}
          filter={filter}
          setFilter={setFilter}
        />
      </aside>
      </main>

    </>
  );
}

function MobileDisabled() {
  return (
    <main className="mobile-disabled" aria-label="Mobile disabled notice">
      <Card className="mobile-disabled-card" variant="secondary">
        <div className="mobile-disabled-mark" aria-hidden="true">
          <MessageCircleMore size={26} strokeWidth={1.7} />
        </div>
        <p className="eyebrow">Desktop experience</p>
        <h1>Open Archive Studio on a larger screen.</h1>
        <p>
          Instagram archives can contain thousands of messages and media files. A laptop or desktop gives you the
          performance and space needed for the full private viewer.
        </p>
      </Card>
    </main>
  );
}

function SearchBox({
  ariaLabel,
  className = "",
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SearchField
      aria-label={ariaLabel}
      className={`search-control ${className}`.trim()}
      fullWidth
      value={value}
      onChange={onChange}
      variant="secondary"
    >
      <SearchField.Group>
        <Search size={15} aria-hidden="true" />
        <SearchField.Input placeholder={placeholder} />
        <SearchField.ClearButton aria-label={`Clear ${ariaLabel.toLowerCase()}`} />
      </SearchField.Group>
    </SearchField>
  );
}

function ThreadList({
  threads,
  selectedThreadId,
  myName,
  onSelect }: {
  threads: ParsedThread[];
  selectedThreadId: string;
  myName: string;
  onSelect: (thread: ParsedThread) => void;
}) {
  return (
    <div className="thread-list" aria-label="Chats">
      {threads.map((thread) => {
        const last = thread.messages[thread.messages.length - 1];
        const title = getChatTitle(thread, myName);
        return (
          <Button
            key={thread.id}
            className={thread.id === selectedThreadId ? "thread-item active" : "thread-item"}
            variant="ghost"
            onPress={() => onSelect(thread)}
          >
            <Avatar fallback={getInitials(title)} compact />
            <span className="thread-copy">
              <strong>{title}</strong>
              <small>{last ? previewMessage(last) : "No messages"}</small>
            </span>
            <time>{formatShortDate(last?.timestamp ?? null)}</time>
          </Button>
        );
      })}
    </div>
  );
}

function DetailedStats({
  backup,
  thread,
  stats,
  visibleCount,
  filter,
  setFilter }: {
  backup: ParsedBackup | null;
  thread: ParsedThread | null;
  stats: ThreadStats | null;
  visibleCount: number;
  filter: MessageFilter;
  setFilter: (filter: MessageFilter) => void;
}) {
  if (!backup || !thread || !stats) {
    return (
      <Card className="details-empty" variant="secondary">
        <div className="details-empty-icon" aria-hidden="true"><FileArchive size={22} /></div>
        <p className="eyebrow">Conversation intelligence</p>
        <h2>Insights, after import.</h2>
        <p>Participant comparisons, word counts, media totals, reactions, and response times appear here.</p>
      </Card>
    );
  }

  const averageWords = stats.totalParticipantMessages
    ? Math.round(stats.totalParticipantWords / stats.totalParticipantMessages)
    : 0;
  const topSender = stats.participantStats[0];
  const topTalker = [...stats.participantStats].sort((a, b) => b.words - a.words)[0];

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Conversation intelligence</p>
          <h2>{thread.title}</h2>
        </div>
        <Chip size="sm" variant="soft">{visibleCount.toLocaleString()} shown</Chip>
      </div>

      <div className="filter-row" aria-label="Message filters">
        {filters.map((item) => (
          <Button
            key={item.id}
            className={filter === item.id ? "active" : ""}
            size="sm"
            variant={filter === item.id ? "primary" : "ghost"}
            onPress={() => setFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="details-grid">
        <SummaryTile label="Words" value={stats.totalParticipantWords.toLocaleString()} />
        <SummaryTile label="Avg words" value={averageWords.toLocaleString()} />
        <SummaryTile label="Images" value={stats.imageCount.toLocaleString()} />
        <SummaryTile label="Reactions" value={stats.reactionCount.toLocaleString()} />
      </div>

      <div className="highlight-grid">
        <Card className="highlight-card" variant="secondary">
          <span>Most messages</span>
          <strong>{topSender?.name ?? "None"}</strong>
          <small>{topSender?.messages.toLocaleString() ?? "0"} messages</small>
        </Card>
        <Card className="highlight-card" variant="secondary">
          <span>Most words</span>
          <strong>{topTalker?.name ?? "None"}</strong>
          <small>{topTalker?.words.toLocaleString() ?? "0"} words</small>
        </Card>
      </div>

      <section className="stats-panel" aria-label="Participant statistics">
        <div className="section-heading compact">
          <h2>Participants</h2>
          <span>{stats.participantStats.length} people</span>
        </div>
        <div className="stats-list">
          {stats.participantStats.map((stat) => (
            <div className="stat-row" key={stat.name}>
              <div className="stat-title">
                <strong>{stat.name}</strong>
                <span>{stat.attachments.toLocaleString()} files</span>
              </div>
              <StatMeter label="Messages" value={stat.messages} total={stats.totalParticipantMessages} />
              <StatMeter label="Words" value={stat.words} total={stats.totalParticipantWords} />
              <ResponseMetric stat={stat} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function ResponseMetric({ stat }: { stat: ParticipantStats }) {
  return (
    <div className="stat-counter">
      <span>Avg response time</span>
      <strong>
        {formatDuration(stat.averageResponseMs)} · {stat.responseCount.toLocaleString()} replies
      </strong>
    </div>
  );
}

function Timeline({ messages, myName }: { messages: ChatMessage[]; myName: string }) {
  let lastDay = "";

  if (!messages.length) {
    return <p className="no-results">No messages match the current view.</p>;
  }

  return (
    <>
      {messages.map((message) => {
        const day = formatDay(message.timestamp);
        const showDay = day !== lastDay;
        lastDay = day;

        return (
          <div key={message.id}>
            {showDay ? <div className="day-separator">{day}</div> : null}
            <MessageBubble message={message} outgoing={Boolean(message.sender && message.sender === myName)} />
          </div>
        );
      })}
    </>
  );
}

function MessageBubble({ message, outgoing }: { message: ChatMessage; outgoing: boolean }) {
  const isMediaOnly = !message.text && message.attachments.length > 0;

  return (
    <article className={`message-row ${outgoing ? "outgoing" : "incoming"}`}>
      <div className={`bubble ${isMediaOnly ? "media-bubble" : ""}`}>
        {message.attachments.map((attachment) => (
          <AttachmentPreview attachment={attachment} key={attachment.path} />
        ))}
        {message.text ? <p>{message.text}</p> : null}
        {message.shareUrl ? (
          <a className="share-link" href={message.shareUrl} target="_blank" rel="noreferrer">
            Open shared link
          </a>
        ) : null}
        {message.reactions.length ? (
          <div className="reaction-row">
            {message.reactions.slice(0, 6).map((reaction, index) => (
              <span key={`${reaction.actor}-${reaction.reaction}-${index}`} title={reaction.actor}>
                {reaction.reaction}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === "image") {
    return <img className="attachment-image" src={attachment.url} alt={attachment.name} loading="lazy" />;
  }

  if (attachment.kind === "video") {
    return <video className="attachment-video" src={attachment.url} controls preload="metadata" />;
  }

  if (attachment.kind === "audio") {
    return (
      <div className="voice-note">
        <div className="voice-play" aria-hidden="true" />
        <div className="voice-wave" aria-hidden="true">
          {Array.from({ length: 22 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <audio src={attachment.url} controls preload="metadata" />
      </div>
    );
  }

  return (
    <a className="attachment-card" href={attachment.url} target="_blank" rel="noreferrer">
      <span className="attachment-glyph"><FileText size={18} /></span>
      <span>
        <strong>{attachment.name}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </span>
    </a>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="summary-tile" variant="secondary">
      <strong>{value}</strong>
      <span>{label}</span>
    </Card>
  );
}

function Avatar({ fallback, compact = false }: { fallback: string; compact?: boolean }) {
  return (
    <HeroAvatar className={compact ? "avatar compact" : "avatar"} size={compact ? "md" : "sm"} variant="soft">
      <HeroAvatar.Fallback>{fallback}</HeroAvatar.Fallback>
    </HeroAvatar>
  );
}

function StatMeter({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <Meter
      aria-label={`${label}: ${value.toLocaleString()}`}
      className="stat-meter"
      maxValue={Math.max(total, 1)}
      value={value}
      size="sm"
    >
      <div>
        <span>{label}</span>
        <strong>
          {value.toLocaleString()} · {percent}%
        </strong>
      </div>
      <Meter.Track><Meter.Fill /></Meter.Track>
    </Meter>
  );
}

function matchesFilter(message: ChatMessage, filter: MessageFilter): boolean {
  if (filter === "all") return true;
  if (filter === "text") return Boolean(message.text.trim());
  if (filter === "images") return message.attachments.some((attachment) => attachment.kind === "image");
  if (filter === "videos") return message.attachments.some((attachment) => attachment.kind === "video");
  if (filter === "audio") return message.attachments.some((attachment) => attachment.kind === "audio");
  if (filter === "shares") return Boolean(message.shareUrl);
  if (filter === "reactions") return message.reactions.length > 0;
  return true;
}

function getThreadStats(thread: ParsedThread): ThreadStats {
  const participantStats = getParticipantStats(thread.messages);
  const totalParticipantMessages = participantStats.reduce((sum, stat) => sum + stat.messages, 0);
  const totalParticipantWords = participantStats.reduce((sum, stat) => sum + stat.words, 0);
  return {
    participantStats,
    totalParticipantMessages,
    totalParticipantWords,
    imageCount: thread.attachments.filter((attachment) => attachment.kind === "image").length,
    shareCount: thread.messages.filter((message) => message.shareUrl).length,
    reactionCount: thread.messages.reduce((sum, message) => sum + message.reactions.length, 0) };
}

function getParticipantStats(messages: ChatMessage[]): ParticipantStats[] {
  const byParticipant = new Map<string, ParticipantStats>();

  for (const message of messages) {
    if (!message.sender || message.isSystem) continue;

    const existing =
      byParticipant.get(message.sender) ??
      ({
        name: message.sender,
        messages: 0,
        words: 0,
        attachments: 0,
        reactions: 0,
        responseCount: 0,
        totalResponseMs: 0,
        averageResponseMs: null } satisfies ParticipantStats);

    existing.messages += 1;
    existing.words += countWords(message.text);
    existing.attachments += message.attachments.length;
    existing.reactions += message.reactions.length;
    byParticipant.set(message.sender, existing);
  }

  addResponseTimes(messages, byParticipant);

  return Array.from(byParticipant.values()).sort((a, b) => b.messages - a.messages || b.words - a.words);
}

function addResponseTimes(messages: ChatMessage[], byParticipant: Map<string, ParticipantStats>) {
  const responseWindowMessages = getResponseWindowMessages(messages);
  let lastParticipantMessage: TimestampedParticipantMessage | null = null;

  for (const message of responseWindowMessages) {
    if (lastParticipantMessage && lastParticipantMessage.sender !== message.sender) {
      const responseMs = message.timestamp.getTime() - lastParticipantMessage.timestamp.getTime();
      const stats = byParticipant.get(message.sender);

      if (stats && responseMs >= 0 && responseMs <= maxResponseGapMs) {
        stats.responseCount += 1;
        stats.totalResponseMs += responseMs;
        stats.averageResponseMs = Math.round(stats.totalResponseMs / stats.responseCount);
      }
    }

    lastParticipantMessage = message;
  }
}

function getResponseWindowMessages(messages: ChatMessage[]): TimestampedParticipantMessage[] {
  return messages
    .filter((message): message is TimestampedParticipantMessage =>
      Boolean(message.sender && !message.isSystem && message.timestamp),
    )
    .slice(-1000);
}

function pickLikelySelf(backup: ParsedBackup): string | null {
  const counts = new Map<string, number>();
  for (const message of backup.messages) {
    if (!message.sender) continue;
    counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function getChatTitle(thread: ParsedThread | null, myName: string): string {
  if (!thread) return "Instagram Preview";
  const others = thread.participants.filter((participant) => participant !== myName);
  if (others.length === 1) return others[0];
  if (others.length > 1) return others.slice(0, 2).join(", ");
  return thread.title;
}

function previewMessage(message: ChatMessage): string {
  if (message.text) return message.text.replace(/\s+/g, " ").slice(0, 72);
  if (message.attachments.length) return `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
  if (message.reactions.length) return "Reaction";
  return "Message";
}

function getInitials(name?: string): string {
  if (!name) return "IG";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:[''][\p{L}\p{N}]+)?/gu)?.length ?? 0;
}

function formatDay(date: Date | null): string {
  if (!date) return "Unknown date";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatShortDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateInputValue(date: Date | null): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "Not enough replies";

  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  if (seconds > 0) return `${seconds}s`;
  return "0m";
}











function getEmailUsername(email: string): string {
  return email.split("@")[0] || "user";
}



export default App;
