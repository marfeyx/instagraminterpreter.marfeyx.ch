import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseInstagramBackup, revokeBackupUrls } from "./parser";
import type { Attachment, ChatMessage, MessageFilter, ParsedBackup, ParsedThread } from "./types";

type ParticipantStats = {
  name: string;
  messages: number;
  words: number;
  attachments: number;
  reactions: number;
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
    <main className="app-shell">
      <section className="control-panel" aria-label="Import and chat list">
        <div>
          <p className="eyebrow">Local-only viewer</p>
          <h1>Instagram Chat Backup Manager</h1>
        </div>

        <label className="file-drop">
          <input type="file" accept=".zip,application/zip" onChange={handleFileChange} />
          <span className="file-icon" aria-hidden="true">
            +
          </span>
          <span>{isParsing ? "Reading Instagram ZIP locally..." : "Choose Instagram export ZIP"}</span>
        </label>

        {error ? <p className="error-message">{error}</p> : null}

        {backup ? (
          <>
            <div className="summary-grid">
              <SummaryTile label="Chats" value={backup.threads.length.toLocaleString()} />
              <SummaryTile label="Messages" value={backup.messages.length.toLocaleString()} />
              <SummaryTile label="Files" value={backup.attachments.length.toLocaleString()} />
            </div>

            <label className="field">
              <span>Find chat</span>
              <input
                type="search"
                placeholder="Search names or group titles"
                value={threadQuery}
                onChange={(event) => setThreadQuery(event.target.value)}
              />
            </label>

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
          <div className="privacy-note">
            <strong>No upload, no cloud processing.</strong>
            <span>The ZIP is read by your browser on this device. Messages and media stay in memory only.</span>
          </div>
        )}

        <a
          className="issue-link"
          href="https://github.com/marfeyx/instagraminterpreter.marfeyx.ch/issues?subject=Instagram%20Chat%20Backup%20Manager%20Issue"
        >
          <span>Report issues</span>
          <strong>GitHub issue tracker</strong>
        </a>
      </section>

      <section className="phone-stage" aria-label="Instagram-style chat preview">
        <div className="phone-frame">
          <div className="phone-status">
            <span className="status-time">{importedAt}</span>
            <span className="dynamic-island" aria-hidden="true" />
          </div>

          <div className="chat-header">
            <button className="back-button" type="button" aria-label="Back">
              <span>‹</span>
            </button>
            <div className="contact-stack">
              <Avatar fallback={getInitials(getChatTitle(selectedThread, myName))} />
              <div className="chat-title">
                <strong>{getChatTitle(selectedThread, myName)}</strong>
                <span>{selectedThread ? `${selectedThread.messages.length.toLocaleString()} messages` : "Instagram preview"}</span>
              </div>
            </div>
            <div className="header-actions" aria-hidden="true">
              <span />
              <span />
            </div>
          </div>

          {selectedThread ? (
            <div className="toolbar">
              <label className="toolbar-search">
                <input
                  type="search"
                  placeholder="Search messages"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <input
                className="date-input"
                type="date"
                value={dateQuery}
                onChange={(event) => setDateQuery(event.target.value)}
                aria-label="Filter by date"
              />
            </div>
          ) : null}

          <div className="message-list">
            {selectedThread ? (
              <Timeline messages={visibleMessages} myName={myName} />
            ) : (
              <div className="empty-state">
                <div className="empty-mark" aria-hidden="true">
                  IG
                </div>
                <h2>Select an Instagram export ZIP</h2>
                <p>All conversations will appear here in an Instagram-style message view.</p>
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
  );
}

function ThreadList({
  threads,
  selectedThreadId,
  myName,
  onSelect,
}: {
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
          <button
            key={thread.id}
            className={thread.id === selectedThreadId ? "thread-item active" : "thread-item"}
            type="button"
            onClick={() => onSelect(thread)}
          >
            <Avatar fallback={getInitials(title)} compact />
            <span>
              <strong>{title}</strong>
              <small>{last ? previewMessage(last) : "No messages"}</small>
            </span>
            <time>{formatShortDate(last?.timestamp ?? null)}</time>
          </button>
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
  setFilter,
}: {
  backup: ParsedBackup | null;
  thread: ParsedThread | null;
  stats: ThreadStats | null;
  visibleCount: number;
  filter: MessageFilter;
  setFilter: (filter: MessageFilter) => void;
}) {
  if (!backup || !thread || !stats) {
    return (
      <div className="details-empty">
        <p className="eyebrow">Detailed stats</p>
        <h2>Import a backup to see totals</h2>
        <p>Chat counts, participant comparisons, media totals, shares, reactions, and date ranges will appear here.</p>
      </div>
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
          <p className="eyebrow">Detailed stats</p>
          <h2>{thread.title}</h2>
        </div>
        <span>{visibleCount.toLocaleString()} shown</span>
      </div>

      <div className="filter-row" aria-label="Message filters">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "active" : ""}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="details-grid">
        <SummaryTile label="Words" value={stats.totalParticipantWords.toLocaleString()} />
        <SummaryTile label="Avg words" value={averageWords.toLocaleString()} />
        <SummaryTile label="Images" value={stats.imageCount.toLocaleString()} />
        <SummaryTile label="Reactions" value={stats.reactionCount.toLocaleString()} />
      </div>

      <div className="highlight-grid">
        <div className="highlight-card">
          <span>Most messages</span>
          <strong>{topSender?.name ?? "None"}</strong>
          <small>{topSender?.messages.toLocaleString() ?? "0"} messages</small>
        </div>
        <div className="highlight-card">
          <span>Most words</span>
          <strong>{topTalker?.name ?? "None"}</strong>
          <small>{topTalker?.words.toLocaleString() ?? "0"} words</small>
        </div>
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
            </div>
          ))}
        </div>
      </section>
    </>
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
      <span className="attachment-glyph">doc</span>
      <span>
        <strong>{attachment.name}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </span>
    </a>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-tile">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Avatar({ fallback, compact = false }: { fallback: string; compact?: boolean }) {
  return (
    <span className={compact ? "avatar compact" : "avatar"} aria-hidden="true">
      {fallback}
    </span>
  );
}

function StatMeter({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="stat-meter">
      <div>
        <span>{label}</span>
        <strong>
          {value.toLocaleString()} · {percent}%
        </strong>
      </div>
      <div className="meter-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
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
    reactionCount: thread.messages.reduce((sum, message) => sum + message.reactions.length, 0),
  };
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
      } satisfies ParticipantStats);

    existing.messages += 1;
    existing.words += countWords(message.text);
    existing.attachments += message.attachments.length;
    existing.reactions += message.reactions.length;
    byParticipant.set(message.sender, existing);
  }

  return Array.from(byParticipant.values()).sort((a, b) => b.messages - a.messages || b.words - a.words);
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

export default App;
