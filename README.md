# Instagram Chat Backup Manager

A local-only static web app for viewing Instagram information backup ZIP files. It shows all message threads in an Instagram-style interface and provides detailed stats for a selected chat.

## Features

- Import Instagram **Download your information** ZIP exports.
- Parse `your_instagram_activity/messages/.../message_*.json` locally in the browser.
- Show every chat thread from inbox-style export folders.
- Render messages in an Instagram-style phone preview.
- Display text messages, photos, videos, audio files, documents, shared links, reactions, and call-duration entries.
- Automatically detect the most likely account owner so outgoing and incoming messages align correctly.
- Search chats by title or participant.
- Search messages by text, sender, file name, or reaction.
- Filter messages by all, text, images, videos, audio, shares, or reactions.
- Filter a selected chat by date.
- Show backup totals: chats, messages, files.
- Show selected-chat stats:
  - total words
  - average words per message
  - image, share, and reaction counts
  - most messages
  - most words
  - per-participant message and word percentages

## Privacy And Security

- The selected ZIP file is read by your browser on your own computer.
- No chat content is uploaded to a server.
- There is no backend service.
- Imported messages and media are kept in browser memory only.
- The app does not save imported backup data to browser storage.
- Refreshing or closing the page clears the loaded backup from memory.
- Media previews use temporary local browser object URLs.

After dependencies are installed, the app itself can be used without internet access.

## GitHub Safety

This repository includes `.gitignore` rules that block common private Instagram export data:

- Instagram ZIP archives
- extracted `your_instagram_activity/` folders
- extracted `media/` and `messages/` folders
- photos, videos, audio, documents, text exports, CSV files, contact cards, and logs
- `.env` files
- `node_modules/`
- `dist/`

Before pushing, verify what Git will include:

```powershell
git status --short
```

To also see ignored files:

```powershell
git status --short --ignored
```

Do not commit personal Instagram exports, extracted backup folders, private media, screenshots, or generated files containing message content.

## Requirements

Install these first:

- [Node.js](https://nodejs.org/) version 20 or newer
- npm, included with Node.js

Check your installation:

```powershell
node --version
npm --version
```

## Local Development

1. Open a terminal in this project folder.

2. Install dependencies:

```powershell
npm install
```

3. Start the local development server:

```powershell
npm run dev
```

4. Open the local URL shown in the terminal. By default it is:

```text
http://127.0.0.1:5173
```

This URL runs on your own computer.

## Production Build

Create a production build:

```powershell
npm run build
```

The built files are created in:

```text
dist/
```

Preview the production build locally:

```powershell
npm run preview
```

## How To Export Instagram Messages

In Instagram:

1. Open **Accounts Center**.
2. Open **Your information and permissions**.
3. Choose **Download your information**.
4. Select the Instagram account.
5. Choose messages or a complete information export.
6. Pick JSON format if Instagram offers a format choice.
7. Download the ZIP file when Instagram finishes preparing it.

In this app:

1. Click **Choose Instagram export ZIP**.
2. Select the downloaded ZIP file.
3. Select any chat in the left panel.
4. Use message search, date search, and filters to inspect the conversation.

## Supported Backups

Supported:

- Instagram information export ZIPs containing JSON message files.
- Inbox, archived, filtered, and message-request thread folders.
- Exports with or without media.

Not supported:

- Instagram data downloaded only as HTML.
- Password-protected archives.
- Direct login to Instagram.

## Troubleshooting

If no chats appear, confirm the ZIP contains:

```text
your_instagram_activity/messages/.../message_1.json
```

If media does not appear, download a full Instagram export that includes media.

If the app does not start, reinstall dependencies:

```powershell
npm install
```

If the build fails, run:

```powershell
npm run build
```

and check the terminal error output.
