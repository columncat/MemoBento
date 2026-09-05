"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Download, ExternalLink, Loader2, Save, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { mediaKindOf } from "@/lib/file-kind";
import { confirmMemoDelete } from "@/lib/preferences";
import { startDownload } from "@/lib/download";
import {
  formatBytes,
  memoLabel,
  viewUrl,
  type MemoDTO,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

import { MemoIcon } from "./memo-item";

/** 텍스트 파일 미리보기 상한 — 이보다 크면 앞부분만 보여준다. */
const TEXT_PREVIEW_LIMIT = 512 * 1024;

interface Props {
  memo: MemoDTO | null;
  onClose: () => void;
  onSave: (
    memo: MemoDTO,
    patch: { text?: string; title?: string; url?: string },
  ) => Promise<void>;
  onDelete: (memo: MemoDTO) => Promise<void>;
}

export function MemoViewer({ memo, onClose, onSave, onDelete }: Props) {
  const [draftText, setDraftText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftText(memo?.text ?? "");
    setDraftTitle(memo?.title ?? "");
    setDraftUrl(memo?.url ?? "");
    setError(null);
  }, [memo]);

  if (!memo) {
    return (
      <Dialog.Root open={false} onOpenChange={() => undefined}>
        <Dialog.Portal />
      </Dialog.Root>
    );
  }

  const dirty =
    (memo.type === "text" && draftText !== (memo.text ?? "")) ||
    (memo.type !== "text" && draftTitle !== (memo.title ?? "")) ||
    (memo.type === "link" && draftUrl !== (memo.url ?? ""));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: { text?: string; title?: string; url?: string } = {};
      if (memo.type === "text") patch.text = draftText;
      else patch.title = draftTitle;
      if (memo.type === "link") patch.url = draftUrl;
      await onSave(memo, patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmMemoDelete("이 메모를 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(memo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {/* pointerdown 전파 차단 — 포털 이벤트가 뒤쪽 dnd-kit 센서를 깨우지 않도록 */}
        <Dialog.Overlay
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(1040px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-4 border-b border-(--color-border-soft) px-6 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
                <MemoIcon memo={memo} className="h-4 w-4 text-(--color-fg-3)" />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title asChild>
                  {memo.type === "text" ? (
                    <h2
                      className="text-[18px] leading-tight"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      메모
                    </h2>
                  ) : (
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder={memoLabel(memo)}
                      className="w-full rounded-md bg-transparent text-[18px] leading-tight text-(--color-fg) outline-none placeholder:text-(--color-fg-3) focus:bg-(--color-bg-2) focus:px-2 focus:py-0.5 focus:ring-1 focus:ring-(--color-accent)/60"
                      style={{ fontFamily: "var(--font-serif)" }}
                    />
                  )}
                </Dialog.Title>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-(--color-fg-4)">
                  {memo.file && (
                    <span className="font-mono">
                      {memo.file.name} · {formatBytes(memo.file.size)}
                    </span>
                  )}
                  {memo.createdAt > 0 && (
                    <span className="font-mono">
                      {formatDateTime(memo.createdAt)}
                    </span>
                  )}
                  {memo.legacy && (
                    <span className="rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] text-(--color-accent-strong)">
                      MailBento 동기화
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {memo.file && (
                <a
                  href={viewUrl(memo.file, { dl: true })}
                  onClick={(e) => {
                    e.preventDefault();
                    startDownload(memo.file!);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
                >
                  <Download className="h-3.5 w-3.5" />
                  다운로드
                </a>
              )}
              {memo.type === "link" && memo.url && (
                <a
                  href={memo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  열기
                </a>
              )}
              <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          {/* 본문 */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <ViewerBody
              memo={memo}
              draftText={draftText}
              onDraftText={setDraftText}
              draftUrl={draftUrl}
              onDraftUrl={setDraftUrl}
            />
          </div>

          {/* 푸터 */}
          <div className="flex items-center justify-between gap-3 border-t border-(--color-border-soft) px-6 py-3">
            <div className="min-w-0 flex-1 text-xs text-(--color-danger)">
              {error}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3.5 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger) disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !dirty}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition",
                  dirty
                    ? "bg-(--color-accent) text-(--color-bg) hover:bg-(--color-accent-strong)"
                    : "bg-(--color-bg-2) text-(--color-fg-4) ring-1 ring-(--color-border-soft)",
                  busy && "opacity-50",
                )}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                저장
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ViewerBody({
  memo,
  draftText,
  onDraftText,
  draftUrl,
  onDraftUrl,
}: {
  memo: MemoDTO;
  draftText: string;
  onDraftText: (v: string) => void;
  draftUrl: string;
  onDraftUrl: (v: string) => void;
}) {

  if (memo.type === "text") {
    return (
      <textarea
        value={draftText}
        onChange={(e) => onDraftText(e.target.value)}
        rows={14}
        className="scrollbar-thin block min-h-[280px] w-full resize-y bg-transparent p-6 text-sm leading-relaxed text-(--color-fg-2) outline-none"
        placeholder="메모 내용"
      />
    );
  }

  if (memo.type === "link") {
    return (
      <div className="flex flex-col gap-3 p-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
            URL
          </span>
          <input
            value={draftUrl}
            onChange={(e) => onDraftUrl(e.target.value)}
            className="w-full rounded-lg bg-(--color-bg-2) px-3 py-2 font-mono text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
          />
        </label>
        <p className="text-[11px] text-(--color-fg-4)">
          제목은 위쪽 입력란에서 바꿀 수 있습니다.
        </p>
      </div>
    );
  }

  const file = memo.file;
  if (!file) {
    return (
      <div className="px-6 py-12 text-center text-xs text-(--color-fg-4)">
        첨부 파일이 없습니다
      </div>
    );
  }

  if (file.kind === "image") {
    return (
      <div className="thumb-checker grid min-h-[320px] place-items-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={viewUrl(file)}
          alt={file.name}
          className="max-h-[68vh] max-w-full object-contain"
        />
      </div>
    );
  }

  if (file.kind === "pdf") {
    return (
      <iframe
        src={viewUrl(file)}
        title={file.name}
        className="h-[70vh] w-full border-0 bg-white"
      />
    );
  }

  if (file.kind === "text") {
    return <TextFileBody file={file} />;
  }

  /*
   * 소리·영상은 분류상 `file` 이지만 여기서 그냥 튼다.
   *
   * Voice 메모함이 생기면서 이 앱에 기가바이트짜리 파일이 들어오게 됐다.
   * 그대로 두면 목록에서 한 번 잘못 누르는 것이 곧 1GB 내려받기다. 파일
   * 라우트가 Range 를 받으므로 브라우저는 필요한 만큼만 가져가고 탐색도 된다.
   *
   * `preload="metadata"` 인 이유는 길이와 눈금만 있으면 되기 때문이다.
   * 열어 두는 것만으로 통째로 받아 오면 안 누르느니만 못하다.
   */
  const media = mediaKindOf(file.name);
  if (media) return <MediaFileBody file={file} media={media} />;

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <MemoIcon memo={memo} className="h-8 w-8 text-(--color-fg-4)" />
      <p className="text-sm text-(--color-fg-3)">
        앱 안에서 열람할 수 없는 형식입니다
      </p>
      <a
        href={viewUrl(file, { dl: true })}
        onClick={(e) => {
          e.preventDefault();
          startDownload(file);
        }}
        className="rounded-full bg-(--color-accent) px-4 py-2 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
      >
        다운로드 ({formatBytes(file.size)})
      </a>
    </div>
  );
}

/**
 * 소리·영상 재생.
 *
 * ## 못 트는 것을 못 튼다고 말한다
 *
 * 브라우저가 컨테이너는 알아도 **안의 코덱을 모르면** 재생기는 아무 말 없이
 * 죽은 막대가 된다. 실제로 겪은 것이 ALAC 이 든 `.m4a` 다 — 확장자도 MIME 도
 * `.m4a`(`audio/mp4`) 그대로라 여기까지 멀쩡히 오는데, 크로뮴은
 * `DEMUXER_ERROR_NO_SUPPORTED_STREAMS` 로 거절한다 (사파리는 튼다). 아이폰
 * 음성 메모의 "무손실" 설정이 이 형식으로 녹음한다.
 *
 * 그때 화면이 아무 말도 안 하면 사람은 파일이 깨진 줄 안다. 파일은 멀쩡하고
 * VoiceBento 의 전사도 정상으로 끝나 있다(ffmpeg 은 ALAC 을 푼다) — 못 트는
 * 것은 이 브라우저뿐이다. 그 사실을 적고 내려받기를 남겨 둔다.
 *
 * VoiceBento 의 `audio-bar.tsx` 가 이미 같은 줄을 달고 있다. 같은 파일을 두
 * 앱에서 여는데 한쪽만 침묵하면 안 된다.
 */
function MediaFileBody({
  file,
  media,
}: {
  file: NonNullable<MemoDTO["file"]>;
  media: "audio" | "video";
}) {
  const [failed, setFailed] = useState(false);

  /*
   * `preload="metadata"` — 길이와 눈금만 받아 둔다. 여는 것만으로 통째로
   * 받아 오면 안 누르느니만 못하다 (여기 오는 파일은 기가바이트급이다).
   */
  const common = {
    src: viewUrl(file),
    controls: true,
    preload: "metadata" as const,
    onError: () => setFailed(true),
    onLoadedMetadata: () => setFailed(false),
  };

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10">
      {media === "audio" ? (
        <audio {...common} className="w-full max-w-xl" />
      ) : (
        <video {...common} className="max-h-[62vh] w-full max-w-3xl rounded-lg bg-black" />
      )}

      {failed && (
        <p className="flex max-w-xl items-start gap-1.5 rounded-lg bg-(--color-danger)/10 px-2.5 py-1.5 text-[11px] break-keep text-(--color-danger) ring-1 ring-(--color-danger)/25">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {/*
            원인을 하나로 못 박지 않는다. `onError` 는 코덱을 모를 때만 터지는
            것이 아니라 **세션이 풀려 401 이 왔을 때와 파일 본체가 없어 410 이
            왔을 때도 똑같이** 터진다 — 크로뮴에서 셋 다 `code 4`
            (`MEDIA_ELEMENT_ERROR: Format error`) 로 구별이 안 되는 것을 재서
            확인했다. 코덱이라고 단정하면 다시 로그인하면 될 사람이 코덱을 쫓게
            되고, "파일은 그대로 있다" 는 410 일 때 거짓말이 된다.
            (VoiceBento 의 `audio-bar.tsx` 가 같은 이유로 안 단정한다.)
          */}
          <span>
            재생하지 못했습니다. 로그인이 풀렸거나, 브라우저가 이 파일의 코덱을
            모르는 경우입니다. 내려받아 다른 재생기로 열어 볼 수 있습니다.
          </span>
        </p>
      )}

      <a
        href={viewUrl(file, { dl: true })}
        onClick={(e) => {
          e.preventDefault();
          startDownload(file);
        }}
        className="text-[11px] text-(--color-fg-4) underline-offset-2 hover:text-(--color-fg-2) hover:underline"
      >
        내려받기 ({formatBytes(file.size)})
      </a>
    </div>
  );
}

function TextFileBody({ file }: { file: NonNullable<MemoDTO["file"]> }) {
  const url = viewUrl(file);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setText(null);
    setError(null);
    setTruncated(false);

    fetch(url, { signal: ac.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (body.length > TEXT_PREVIEW_LIMIT) {
          setText(body.slice(0, TEXT_PREVIEW_LIMIT));
          setTruncated(true);
        } else {
          setText(body);
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "불러오기 실패");
      });

    return () => ac.abort();
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-(--color-danger)">
        <AlertCircle className="h-6 w-6" />
        <span className="text-xs">{error}</span>
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-12 text-xs text-(--color-fg-4)">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  return (
    <>
      <pre className="m-0 max-h-[68vh] overflow-auto p-6 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-(--color-fg-2)">
        {text}
      </pre>
      {truncated && (
        <p className="px-6 pb-4 text-[11px] text-(--color-fg-4)">
          파일이 커서 앞부분만 표시했습니다 — 전체 내용은 다운로드하세요.
        </p>
      )}
    </>
  );
}
