import { encryptChunk, getFileKey } from "./crypto-client";
import { isUnauthenticated, readJson } from "./read-json";
import { makeThumbnail } from "./thumbnail";
import type { NotebookDTO } from "./types";

/**
 * 업로드 큐.
 *
 * 파일을 한 번에 하나씩, 조각 단위로 올린다. 조각은 브라우저에서 암호화한 뒤
 * 보내므로 서버도 중계자도 평문을 보지 못한다. 조각마다 재시도하기 때문에
 * 큰 파일에서 한 번 끊겼다고 처음부터 다시 올리지 않는다.
 */

export type TransferStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "done"
  | "error"
  | "canceled";

export interface TransferItem {
  id: string;
  name: string;
  /** 평문 기준 크기. */
  size: number;
  notebookId: string;
  notebookName: string;
  status: TransferStatus;
  /** 올라간 평문 바이트 수. */
  sent: number;
  error?: string;
  startedAt: number;
}

type Listener = (items: TransferItem[]) => void;

const items: TransferItem[] = [];
const listeners = new Set<Listener>();
const canceled = new Set<string>();
let running = false;
/** 업로드가 끝날 때마다 대시보드가 목록을 갱신하도록 알린다. */
let onFinished: ((notebooks: NotebookDTO[]) => void) | null = null;

const CHUNK_RETRIES = 3;

function emit() {
  const snapshot = items.map((i) => ({ ...i }));
  listeners.forEach((l) => l(snapshot));
}

export function subscribeTransfers(l: Listener): () => void {
  listeners.add(l);
  l(items.map((i) => ({ ...i })));
  return () => listeners.delete(l);
}

export function setTransferSink(fn: (notebooks: NotebookDTO[]) => void): void {
  onFinished = fn;
}

export function cancelTransfer(id: string): void {
  canceled.add(id);
  const item = items.find((i) => i.id === id);
  if (item && (item.status === "queued" || item.status === "preparing")) {
    item.status = "canceled";
    emit();
  }
}

/** 끝난 항목 치우기. */
export function clearFinishedTransfers(): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (["done", "error", "canceled"].includes(items[i].status)) items.splice(i, 1);
  }
  emit();
}

export function enqueueUploads(notebook: NotebookDTO, files: File[]): void {
  for (const file of files) {
    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: file.size,
      notebookId: notebook.id,
      notebookName: notebook.name,
      status: "queued",
      sent: 0,
      startedAt: Date.now(),
    });
    queue.push({ item: items[items.length - 1], file });
  }
  emit();
  void pump();
}

const queue: { item: TransferItem; file: File }[] = [];

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (canceled.has(next.item.id)) {
        next.item.status = "canceled";
        emit();
        continue;
      }
      await uploadOne(next.item, next.file);
    }
  } finally {
    running = false;
  }
}

async function uploadOne(item: TransferItem, file: File): Promise<void> {
  item.status = "preparing";
  item.sent = 0;
  emit();

  let uploadId: string | null = null;
  try {
    const key = await getFileKey();
    // 썸네일은 원본을 읽어야 하므로 업로드 전에 만든다.
    // 미리보기도 평문으로 남기지 않도록 레코드 하나로 암호화해서 보낸다.
    const thumbDataUrl = await makeThumbnail(file);
    const thumb = thumbDataUrl
      ? await encryptThumb(key, thumbDataUrl)
      : null;

    const initRes = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: item.notebookId,
        name: file.name,
        size: file.size,
        encrypted: true,
      }),
    });
    const init = await readJson<{
      uploadId?: string;
      chunkSize?: number;
      chunks?: number;
    }>(initRes);
    if (!init.uploadId || !init.chunkSize) {
      throw new Error("업로드 자리를 받지 못했습니다");
    }
    uploadId = init.uploadId;

    item.status = "uploading";
    emit();

    const chunkSize = init.chunkSize;
    const total = Math.max(1, Math.ceil(file.size / chunkSize));

    for (let index = 0; index < total; index++) {
      if (canceled.has(item.id)) throw new CanceledError();

      const start = index * chunkSize;
      const slice = file.slice(start, Math.min(file.size, start + chunkSize));
      const plain = new Uint8Array(await slice.arrayBuffer());
      if (plain.byteLength === 0) break;

      const record = await encryptChunk(key, plain);
      await putChunkWithRetry(uploadId, index, record, item);

      item.sent = Math.min(file.size, start + plain.byteLength);
      emit();
    }

    if (canceled.has(item.id)) throw new CanceledError();

    const finRes = await fetch("/api/upload/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, thumb: thumb ?? undefined }),
    });
    const fin = await readJson<{ notebooks?: NotebookDTO[] }>(finRes);

    item.status = "done";
    item.sent = file.size;
    emit();
    if (fin.notebooks) onFinished?.(fin.notebooks);
  } catch (e) {
    /*
     * 반쯤 올라간 조각은 치운다 — 다만 로그인이 풀린 경우는 빼고.
     *
     * 큰 파일은 조각 전송에만 수십 분이 걸린다. 마지막 확정에서 세션이
     * 만료되면 조각은 서버에 다 올라간 뒤인데, 여기서 지워 버리면 그 수십 분이
     * 통째로 날아간다. 지우자고 보낸 요청도 어차피 같은 이유로 거절된다.
     * 남겨 두면 다시 로그인한 뒤 이어 볼 여지가 있고, 아니어도 서버가 때가
     * 되면 스스로 치운다.
     */
    if (uploadId && !isUnauthenticated(e)) {
      void fetch(`/api/upload/finish?id=${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    if (e instanceof CanceledError || canceled.has(item.id)) {
      item.status = "canceled";
    } else {
      item.status = "error";
      item.error = isUnauthenticated(e)
        ? "로그인이 풀렸습니다. 새로고침하고 다시 시도하세요."
        : e instanceof Error
          ? e.message
          : "업로드 실패";
    }
    emit();
  }
}

class CanceledError extends Error {}

/** data URL 썸네일 → 암호화 레코드(base64). */
async function encryptThumb(
  key: CryptoKey,
  dataUrl: string,
): Promise<string | null> {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    const bin = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const record = await encryptChunk(key, bytes);
    let out = "";
    for (let i = 0; i < record.length; i++) out += String.fromCharCode(record[i]);
    return btoa(out);
  } catch {
    return null;
  }
}

async function putChunkWithRetry(
  uploadId: string,
  index: number,
  record: Uint8Array,
  item: TransferItem,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
    if (canceled.has(item.id)) throw new CanceledError();
    try {
      const res = await fetch(
        `/api/upload/chunk?id=${encodeURIComponent(uploadId)}&index=${index}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: record as unknown as BodyInit,
        },
      );
      if (res.ok) return;
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      lastErr = new Error(j.error ?? `HTTP ${res.status}`);
      // 4xx 는 재시도해도 같다
      if (res.status >= 400 && res.status < 500) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof CanceledError) throw e;
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("조각 전송 실패");
}
