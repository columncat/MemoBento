/**
 * MemoBento 복호화 서비스 워커.
 *
 * 암호화해 올린 파일은 서버에 암호문으로만 있다. 브라우저가 <img> 나 다운로드
 * 링크로 직접 열면 깨진 바이트를 보게 되므로, /dl/<fileId>/<name> 요청을 여기서
 * 가로채 원본 응답을 스트리밍 복호화한 뒤 제대로 된 타입으로 돌려준다.
 *
 * 스트림으로 처리하기 때문에 5GB 파일도 메모리에 통째로 올라가지 않는다.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const GCM_OVERHEAD = IV_LEN + TAG_LEN;

/**
 * 하위 경로 배포에서 앞에 붙는 것 (`/memo` 같은).
 *
 * 빌드할 때 심지 않고 자기 스코프에서 알아낸다. 워커의 스코프는 스크립트가
 * 놓인 자리를 넘을 수 없으므로, 등록될 때 이미 정답이 정해져 있다 —
 * `https://…/memo/` 에서 `/memo` 를 떼면 된다. 뿌리에 있으면 빈 문자열이라
 * 예전과 똑같이 동작한다.
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

/** 앱 안의 절대 경로를 실제 주소로. */
function at(path) {
  return BASE + path;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

let keyPromise = null;

/** 키는 워커가 직접 받아온다 (같은 오리진이라 세션 쿠키가 실린다). */
function getKey() {
  if (!keyPromise) {
    keyPromise = fetch(at("/api/files/key"), { credentials: "same-origin" })
      .then(async (r) => {
        // 401 은 세션이 풀린 것이다. 그대로 "key fetch failed: 401" 이라고
        // 하면 파일을 열었을 때 그 문장이 탭에 뜬다 — 무엇을 해야 하는지가
        // 담겨 있지 않다.
        if (r.status === 401) throw new Error("로그인이 풀렸습니다. 새로고침해 주세요.");
        if (!r.ok) throw new Error("키를 가져오지 못했습니다 (" + r.status + ")");
        // 200 인데 JSON 이 아닐 수 있다 (앞단이 오류 페이지를 감싸 보낼 때).
        const text = await r.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("키 대신 웹 페이지가 왔습니다. 로그인이 풀렸을 수 있습니다.");
        }
      })
      .then(({ key }) => {
        const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
        return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
          "decrypt",
        ]);
      })
      .catch((e) => {
        keyPromise = null;
        throw e;
      });
  }
  return keyPromise;
}

/**
 * 고정 길이 레코드를 모아 하나씩 복호화해 흘려보내는 변환 스트림.
 * 마지막 레코드는 짧을 수 있다.
 */
function decryptStream(key, recordSize, expectedPlainSize) {
  let produced = 0;
  // 들어온 조각을 모아만 두고, 레코드 하나가 찼을 때만 이어붙인다.
  // 조각마다 전체 버퍼를 복사하면 8MB 레코드당 수백 번 복사가 되어
  // 수 GB 파일에서는 사실상 끝나지 않는다.
  let pending = [];
  let pendingLen = 0;

  /** 앞에서 n 바이트를 떼어 하나의 Uint8Array 로 만든다. */
  const take = (n) => {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = pending[0];
      const need = n - off;
      if (head.byteLength <= need) {
        out.set(head, off);
        off += head.byteLength;
        pending.shift();
      } else {
        out.set(head.subarray(0, need), off);
        pending[0] = head.subarray(need);
        off += need;
      }
    }
    pendingLen -= n;
    return out;
  };

  const decryptOne = async (record, controller) => {
    const iv = record.subarray(0, IV_LEN);
    const ct = record.subarray(IV_LEN);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    produced += plain.byteLength;
    controller.enqueue(new Uint8Array(plain));
  };

  return new TransformStream({
    async transform(chunk, controller) {
      pending.push(chunk);
      pendingLen += chunk.byteLength;
      while (pendingLen >= recordSize) {
        await decryptOne(take(recordSize), controller);
      }
    },
    async flush(controller) {
      if (pendingLen > 0) {
        if (pendingLen <= GCM_OVERHEAD) throw new Error("잘린 암호문");
        await decryptOne(take(pendingLen), controller);
      }
      // 업스트림이 레코드 경계에서 일찍 끊기면 복호화는 조용히 성공한다.
      // 그대로 두면 짧은 파일이 "정상 다운로드"로 저장되므로 반드시 길이를 확인한다.
      if (expectedPlainSize > 0 && produced !== expectedPlainSize) {
        throw new Error(
          "길이 불일치: " + produced + " / " + expectedPlainSize + " — 전송이 잘렸습니다",
        );
      }
    },
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // 썸네일: /dl/t/<fileId>  (레코드 하나짜리 암호문)
  const t = new RegExp("^" + BASE + "/dl/t/([^/]+)$").exec(url.pathname);
  if (t) {
    event.respondWith(serveThumb(t[1]));
    return;
  }

  const m = new RegExp("^" + BASE + "/dl/([^/]+)(?:/.*)?$").exec(url.pathname);
  if (!m) return;

  const fileId = m[1];
  const wantsDownload = url.searchParams.get("dl") === "1";
  event.respondWith(serve(fileId, wantsDownload, event.request));
});

async function serveThumb(fileId) {
  const upstream = await fetch(
    at(`/api/files/${encodeURIComponent(fileId)}/thumb`),
    { credentials: "same-origin" },
  );
  if (!upstream.ok) return upstream;
  if (upstream.headers.get("X-MB-Encrypted") !== "1") return upstream;

  try {
    const key = await getKey();
    const record = new Uint8Array(await upstream.arrayBuffer());
    const iv = record.subarray(0, IV_LEN);
    const ct = record.subarray(IV_LEN);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new Response(plain, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("X-MB-Type") || "image/webp",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response("", { status: 500 });
  }
}

async function serve(fileId, wantsDownload, request) {
  // Range 는 암호문 오프셋 기준이라 그대로 넘기면 복호화가 어긋난다.
  // 처음부터 스트리밍해서 내려준다 (브라우저 다운로드 관리자가 이어서 처리).
  const upstream = await fetch(at(`/api/files/${encodeURIComponent(fileId)}`), {
    credentials: "same-origin",
    cache: "no-store",
    headers: request.headers.get("accept")
      ? { accept: request.headers.get("accept") }
      : undefined,
  });

  if (!upstream.ok || !upstream.body) return upstream;

  const encrypted = upstream.headers.get("X-MB-Encrypted") === "1";
  const type =
    upstream.headers.get("X-MB-Type") ||
    upstream.headers.get("Content-Type") ||
    "application/octet-stream";
  const rawName = upstream.headers.get("X-MB-Name") || fileId;
  let name = fileId;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    /* 그대로 둔다 */
  }
  const plainSize = upstream.headers.get("X-MB-Plain-Size");

  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; ${disposition(name)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  // 암호화 파일은 Range 를 지원하지 않는다고 알려 브라우저가 부분요청을 걸지 않게 함
  headers.set("Accept-Ranges", "none");
  if (plainSize) headers.set("Content-Length", plainSize);

  if (!encrypted) {
    return new Response(upstream.body, { status: 200, headers });
  }

  const chunkSize = Number(upstream.headers.get("X-MB-Chunk-Size") || 0);
  if (!chunkSize) {
    return new Response("복호화 정보를 읽을 수 없습니다", { status: 500 });
  }

  try {
    const key = await getKey();
    const body = upstream.body.pipeThrough(
      decryptStream(key, chunkSize + GCM_OVERHEAD, Number(plainSize || 0)),
    );
    return new Response(body, { status: 200, headers });
  } catch (e) {
    return new Response("복호화 실패: " + (e && e.message), { status: 500 });
  }
}

function disposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
