import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseInstagramBackup, revokeBackupUrls } from "./parser";
import { AccountProfile } from "./accountProfile";
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

type AuthMode = "login" | "register";

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
const maxAuthAttempts = 5;
const authLockoutMs = 60 * 1000;
const maxAuthSubmissions = 5;
const authRateLimitWindowMs = 60 * 1000;

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
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [accountActionError, setAccountActionError] = useState("");
  const [authFailures, setAuthFailures] = useState(0);
  const [authLockedUntil, setAuthLockedUntil] = useState<number | null>(null);
  const [authRateLimitedUntil, setAuthRateLimitedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousBackup = useRef<ParsedBackup | null>(null);
  const authSubmissionTimes = useRef<number[]>([]);

  const isAuthLocked = Boolean(authLockedUntil && authLockedUntil > now);
  const isAuthRateLimited = Boolean(authRateLimitedUntil && authRateLimitedUntil > now);
  const isAuthBlocked = isAuthLocked || isAuthRateLimited;
  const lockoutSeconds = authLockedUntil ? Math.max(0, Math.ceil((authLockedUntil - now) / 1000)) : 0;
  const rateLimitSeconds = authRateLimitedUntil ? Math.max(0, Math.ceil((authRateLimitedUntil - now) / 1000)) : 0;
  const authBlockSeconds = Math.max(lockoutSeconds, rateLimitSeconds);
  const authBlockMessage = isAuthLocked
    ? `Too many failed attempts. Try again in ${lockoutSeconds} seconds.`
    : isAuthRateLimited
      ? `Too many login attempts. Try again in ${rateLimitSeconds} seconds.`
      : "";

  useEffect(() => {
    return () => revokeBackupUrls(previousBackup.current);
  }, []);

  useEffect(() => {
    let isMounted = true;

      if (!isMounted) return;
      setAuthUser(data.user);
      setIsAuthReady(true);
    });

    const {
      data: { subscription },
      setAuthUser(session?.user ?? null);
      setIsAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthBlocked) return;

    const intervalId = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(intervalId);
  }, [isAuthBlocked]);

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

    if (!authUser) {
      setAuthError("");
      setIsAuthModalOpen(true);
      return;
    }

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

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAuthBlocked) {
      setAuthError(authBlockMessage);
      return;
    }

    const email = normalizeEmail(authEmail);
    const displayName = authDisplayName.trim();
    const validationError = validateCredentials(email, authPassword, authMode === "register" ? displayName : undefined);
    if (validationError) {
      setAuthError(validationError);
      return;
    }

    const rateLimitError = registerAuthSubmission();
    if (rateLimitError) {
      setAuthError(rateLimitError);
      return;
    }

    setIsAuthenticating(true);
    setAuthError("");

    try {
      const result =
        authMode === "login"
              email,
              password: authPassword,
              options: { data: { display_name: displayName, username: displayName } },
            });

      if (result.error) {
        if (shouldCountAuthFailure(result.error, authMode)) {
          registerAuthFailure();
        }

        setAuthError(getAuthErrorMessage(result.error, authMode));
        return;
      }

      setAuthFailures(0);
      setAuthLockedUntil(null);
      setAuthPassword("");
      setIsAuthModalOpen(false);

      if (authMode === "register" && !result.data.session) {
        setAuthError("Check your email to confirm your account before signing in.");
        setAuthMode("login");
        setIsAuthModalOpen(true);
        return;
      }

      window.setTimeout(() => fileInputRef.current?.click(), 0);
    } catch {
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
    setAuthUser(null);
  }

  async function handleChangeAccount() {
    setAuthUser(null);
    setAuthEmail("");
    setAuthPassword("");
    setAuthDisplayName("");
    setAuthMode("login");
    setAuthError("");
    setAccountActionError("");
    setIsAuthModalOpen(true);
  }

  function registerAuthSubmission(): string {
    const timestamp = Date.now();
    const windowStart = timestamp - authRateLimitWindowMs;
    authSubmissionTimes.current = authSubmissionTimes.current.filter((attemptedAt) => attemptedAt > windowStart);

    if (authSubmissionTimes.current.length >= maxAuthSubmissions) {
      const retryAt = authSubmissionTimes.current[0] + authRateLimitWindowMs;
      setAuthRateLimitedUntil(retryAt);
      setNow(timestamp);
      return `Too many login attempts. Try again in ${Math.ceil((retryAt - timestamp) / 1000)} seconds.`;
    }

    authSubmissionTimes.current.push(timestamp);
    return "";
  }

  function registerAuthFailure() {
    const nextFailures = authFailures + 1;
    setAuthFailures(nextFailures);

    if (nextFailures >= maxAuthAttempts) {
      setAuthLockedUntil(Date.now() + authLockoutMs);
      setNow(Date.now());
      setAuthFailures(0);
    }
  }

  return (
    <>
      <MobileDisabled />
      <main className="app-shell">
      <section className="control-panel" aria-label="Import and chat list">
        <div>
          <p className="eyebrow">Local-only viewer</p>
          <h1>Instagram Chat Backup Manager</h1>
        </div>

        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".zip,application/zip"
          onChange={handleFileChange}
        />
        <button className="file-drop" type="button" onClick={handleUploadClick} disabled={!isAuthReady || isParsing}>
          <span className="file-icon" aria-hidden="true">
            +
          </span>
          <span>{isParsing ? "Reading Instagram ZIP locally..." : "Choose Instagram export ZIP"}</span>
        </button>

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
            <strong>Login required, chat stays local.</strong>
            <span>
              messages and media are kept in memory only.
            </span>
          </div>
        )}

        <footer className="site-footer">
          <div className="footer-links">
            <a href="privacy.html">Privacy Policy</a>
            <a href="https://github.com/marfeyx/instagraminterpreter.marfeyx.ch/issues?subject=Instagram%20Chat%20Backup%20Manager%20Issue">
              Report issues
            </a>
          </div>
          <AccountProfile
            className="footer-account"
            user={authUser}
            isAuthReady={isAuthReady}
            onSignOut={handleLogout}
            onChangeAccount={handleChangeAccount}
            onLogin={() => {
              setAuthMode("login");
              setAuthError("");
              setAccountActionError("");
              setIsAuthModalOpen(true);
            }}
            deleteHref={`https://github.com/marfeyx/instagraminterpreter.marfeyx.ch/issues?subject=Delete%20account%20request&body=${encodeURIComponent(
              `Please delete my Instagram Chat Backup Manager account.

Account: ${authUser?.email ?? (authUser ? getDisplayUsername(authUser) : "")}`,
            )}`}
          />
          {accountActionError ? <p className="footer-account-error">{accountActionError}</p> : null}
        </footer>
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
      {isAuthModalOpen ? (
        <AuthModal
          mode={authMode}
          email={authEmail}
          password={authPassword}
          displayName={authDisplayName}
          error={authError}
          isSubmitting={isAuthenticating}
          isLocked={isAuthBlocked}
          lockoutSeconds={authBlockSeconds}
          lockedMessage={authBlockMessage}
          onModeChange={(mode) => {
            setAuthMode(mode);
            setAuthError("");
          }}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onDisplayNameChange={setAuthDisplayName}
          onClose={() => {
            if (!isAuthenticating) setIsAuthModalOpen(false);
          }}
          onSubmit={handleAuthSubmit}
        />
      ) : null}
    </>
  );
}

function AuthModal({
  mode,
  email,
  password,
  displayName,
  error,
  isSubmitting,
  isLocked,
  lockoutSeconds,
  lockedMessage,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onDisplayNameChange,
  onClose,
  onSubmit,
}: {
  mode: AuthMode;
  email: string;
  password: string;
  displayName: string;
  error: string;
  isSubmitting: boolean;
  isLocked: boolean;
  lockoutSeconds: number;
  lockedMessage: string;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const title = mode === "login" ? "Login to upload" : "Create account";
  const submitText = mode === "login" ? "Login" : "Register";

  return (
    <div className="auth-backdrop" role="presentation">
      <form className="auth-modal" onSubmit={onSubmit} aria-label={title}>
        <div className="auth-modal-header">
          <div>
            <p className="eyebrow">Account required</p>
            <h2>{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close login popup" disabled={isSubmitting}>
            x
          </button>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>
            Login
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => onModeChange("register")}
          >
            Register
          </button>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@example.com"
          />
        </label>

        {mode === "register" ? (
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Your display name"
              minLength={2}
              maxLength={40}
            />
          </label>
        ) : null}

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>

        {error ? <p className="error-message">{error}</p> : null}
        {isLocked ? <p className="auth-hint">{lockedMessage || `Try again in ${lockoutSeconds} seconds.`}</p> : null}

        <button className="auth-submit" type="submit" disabled={isSubmitting || isLocked}>
          {isSubmitting ? "Checking..." : submitText}
        </button>

        <p className="auth-hint">
        </p>
      </form>
    </div>
  );
}

function MobileDisabled() {
  return (
    <main className="mobile-disabled" aria-label="Mobile disabled notice">
      <div className="mobile-disabled-card">
        <div className="mobile-disabled-mark" aria-hidden="true">
          IG
        </div>
        <p className="eyebrow">Desktop only</p>
        <h1>Disabled on mobile due to performance problems</h1>
        <p>
          Instagram exports can include thousands of messages, reactions, and media files. Open this page on a laptop
          or desktop browser for the full local viewer.
        </p>
      </div>
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
        responseCount: 0,
        totalResponseMs: 0,
        averageResponseMs: null,
      } satisfies ParticipantStats);

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

function getAuthErrorMessage(error: AuthError, mode: AuthMode): string {
  const code = getAuthErrorCode(error);
  const message = error.message.toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }

  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }

  if (code === "user_already_exists" || message.includes("already registered") || message.includes("already exists")) {
    return "An account already exists for this email. Login instead.";
  }

  if (code === "weak_password" || message.includes("weak password")) {
    return "Use a stronger password.";
  }

  if (code === "signup_disabled" || message.includes("signups not allowed") || message.includes("signup disabled")) {
    return "New account registration is currently disabled.";
  }

  if (code === "email_address_invalid" || message.includes("invalid email")) {
    return "Enter a valid email address.";
  }

  if (code === "over_email_send_rate_limit") {
    return "Too many confirmation emails were requested. Wait a moment and try again.";
  }

  if (code === "over_request_rate_limit" || error.status === 429) {
    return "Too many requests. Wait a moment and try again.";
  }

  if (code === "user_banned") {
    return "This account is disabled. Contact support if this seems wrong.";
  }

  if (error.status && error.status >= 500) {
  }

  return mode === "login" ? "Login failed. Check your email and password." : "Registration failed. Check your details.";
}

function shouldCountAuthFailure(error: AuthError, mode: AuthMode): boolean {
  if (mode !== "login") return false;

  const code = getAuthErrorCode(error);
  const message = error.message.toLowerCase();
  return code === "invalid_credentials" || message.includes("invalid login credentials");
}

function getAuthErrorCode(error: AuthError): string {
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : "";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateCredentials(email: string, password: string, displayName?: string): string {
  if (!/^[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(email)) {
    return "Enter a valid email address.";
  }

  if (displayName !== undefined) {
    if (!displayName) {
      return "Enter a display name.";
    }

    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,39}$/u.test(displayName)) {
      return "Use a display name with 2-40 letters, numbers, spaces, dots, underscores, or hyphens.";
    }
  }

  if (password.length < 8) {
    return "Use a password with at least 8 characters.";
  }

  return "";
}

function getEmailUsername(email: string): string {
  return email.split("@")[0] || "user";
}

function getDisplayUsername(user: User | null): string {
  if (!user) return "";

  const metadataDisplayName = user.user_metadata?.display_name;
  if (typeof metadataDisplayName === "string" && metadataDisplayName.trim()) {
    return metadataDisplayName.trim();
  }

  const metadataUsername = user.user_metadata?.username;
  if (typeof metadataUsername === "string" && metadataUsername.trim()) {
    return metadataUsername.trim();
  }

  return user.email?.split("@")[0] ?? "user";
}

export default App;
