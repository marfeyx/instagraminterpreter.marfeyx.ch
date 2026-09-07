import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { ARCHIVE_LIMITS, parseInstagramBackup, revokeBackupUrls } from "../src/parser.ts";

async function makeZip(files) {
  const zip = new JSZip();
  for (const [path, contents] of Object.entries(files)) {
    zip.file(path, contents);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  Object.defineProperties(bytes, {
    name: { value: "instagram-export.zip" },
    size: { value: bytes.byteLength },
  });
  return bytes;
}

function messageFile(title, content = "hello", mediaPath) {
  return JSON.stringify({
    title,
    participants: [{ name: "Alice" }, { name: "Bob" }],
    messages: [
      {
        sender_name: "Alice",
        timestamp_ms: 1_700_000_000_000,
        content,
        photos: mediaPath ? [{ uri: mediaPath }] : [],
      },
    ],
  });
}

test("parses every supported message folder and deduplicates media globally", async () => {
  const mediaPath = "your_instagram_activity/messages/media/shared.jpg";
  const file = await makeZip({
    "your_instagram_activity/messages/inbox/one/message_1.json": messageFile("One", "one", mediaPath),
    "your_instagram_activity/messages/archived_threads/two/message_1.json": messageFile("Two", "two", mediaPath),
    "your_instagram_activity/messages/filtered_threads/three/message_1.json": messageFile("Three"),
    "your_instagram_activity/messages/message_requests/four/message_1.json": messageFile("Four"),
    [mediaPath]: new Uint8Array([1, 2, 3, 4]),
    "unrelated-empty-file.txt": new Uint8Array(),
  });

  const backup = await parseInstagramBackup(file);
  try {
    assert.equal(backup.threads.length, 4);
    assert.equal(backup.messages.length, 4);
    assert.equal(backup.attachments.length, 1);
    assert.equal(backup.messages.filter((message) => message.attachments.length === 1).length, 2);
    const attachedUrls = backup.messages.flatMap((message) => message.attachments.map((attachment) => attachment.url));
    assert.equal(new Set(attachedUrls).size, 1);
  } finally {
    revokeBackupUrls(backup);
  }
});

test("rejects an oversized compressed file before ZIP parsing", async () => {
  const oversizedFile = {
    name: "oversized.zip",
    size: ARCHIVE_LIMITS.compressedBytes + 1,
  };

  await assert.rejects(() => parseInstagramBackup(oversizedFile), /ZIP file size limit/);
});

test("rejects excessive central-directory records before JSZip materializes them", async () => {
  const zip = new JSZip();
  for (let index = 0; index <= ARCHIVE_LIMITS.entries; index++) {
    zip.file(`empty-${index}`, "");
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  Object.defineProperties(bytes, {
    name: { value: "too-many-entries.zip" },
    size: { value: bytes.byteLength },
  });
  const originalLoadAsync = JSZip.loadAsync;
  let loadCalled = false;
  JSZip.loadAsync = (...args) => {
    loadCalled = true;
    return originalLoadAsync(...args);
  };

  try {
    await assert.rejects(() => parseInstagramBackup(bytes), /ZIP entry count limit/);
    assert.equal(loadCalled, false);
  } finally {
    JSZip.loadAsync = originalLoadAsync;
  }
});

test("rejects a highly compressed oversized message shard", async () => {
  const file = await makeZip({
    "your_instagram_activity/messages/inbox/one/message_1.json": messageFile(
      "One",
      "x".repeat(ARCHIVE_LIMITS.messageFileBytes),
    ),
  });

  await assert.rejects(() => parseInstagramBackup(file), /message file size limit/);
});

test("rejects excessive media references before creating object URLs", async () => {
  const photos = Array.from({ length: ARCHIVE_LIMITS.mediaReferences + 1 }, (_, index) => ({
    uri: `media/missing-${index}.jpg`,
  }));
  const file = await makeZip({
    "your_instagram_activity/messages/inbox/one/message_1.json": JSON.stringify({
      title: "One",
      participants: [{ name: "Alice" }],
      messages: [{ sender_name: "Alice", timestamp_ms: 1_700_000_000_000, photos }],
    }),
  });
  const originalCreateObjectUrl = URL.createObjectURL;
  let createdUrls = 0;
  URL.createObjectURL = (...args) => {
    createdUrls += 1;
    return originalCreateObjectUrl(...args);
  };

  try {
    await assert.rejects(() => parseInstagramBackup(file), /media reference count limit/);
    assert.equal(createdUrls, 0);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
  }
});

test("rejects excessive participant objects under the structural token budget", async () => {
  const participants = Array.from({ length: ARCHIVE_LIMITS.participants + 1 }, () => ({ name: "A" }));
  const file = await makeZip({
    "your_instagram_activity/messages/inbox/one/message_1.json": JSON.stringify({ participants, messages: [] }),
  });

  await assert.rejects(() => parseInstagramBackup(file), /participant count limit/);
});

test("keeps web share links and rejects executable URL schemes", async () => {
  const safePath = "your_instagram_activity/messages/inbox/safe/message_1.json";
  const unsafePath = "your_instagram_activity/messages/inbox/unsafe/message_1.json";
  const file = await makeZip({
    [safePath]: JSON.stringify({
      title: "Safe",
      messages: [{ sender_name: "Alice", share: { link: "https://example.com/post" } }],
    }),
    [unsafePath]: JSON.stringify({
      title: "Unsafe",
      messages: [{ sender_name: "Alice", share: { link: "javascript:alert(1)" } }],
    }),
  });

  const backup = await parseInstagramBackup(file);
  try {
    const safe = backup.messages.find((message) => message.text.includes("https://example.com/post"));
    const unsafe = backup.messages.find((message) => message.text.includes("javascript:alert(1)"));
    assert.equal(safe?.shareUrl, "https://example.com/post");
    assert.equal(unsafe?.shareUrl, undefined);
  } finally {
    revokeBackupUrls(backup);
  }
});
