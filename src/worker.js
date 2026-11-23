// 応募フォームの送信を受け取り、メールで転送する Worker。
// /api/apply 以外のリクエストは、公開フォルダ（public/）のページをそのまま返す。
import { EmailMessage } from "cloudflare:email";

const MAX = { name: 100, school: 150, email: 200, phone: 40, message: 2000 };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const b64 = (text) => {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
};
const encodedWord = (text) => `=?UTF-8?B?${b64(text)}?=`;
const clean = (value, max) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const oneLine = (value, max) => clean(value, max).replace(/\s+/g, " ");

async function handleApply(request, env) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  // 迷惑投稿対策：人間には見えない欄に入力があれば、成功したふりをして捨てる
  if (clean(data.website, 200)) return json({ ok: true });

  const name = oneLine(data.name, MAX.name);
  const school = oneLine(data.school, MAX.school);
  const email = oneLine(data.email, MAX.email);
  const phone = oneLine(data.phone, MAX.phone);
  const message = clean(data.message, MAX.message);

  if (!name || !school || !EMAIL_RE.test(email) || data.consent !== true) {
    return json({ ok: false, error: "invalid" }, 400);
  }

  const body = [
    "西条インターン.com の応募フォームから送信がありました。",
    "",
    `お名前：${name}`,
    `大学・学部・学年：${school}`,
    `メールアドレス：${email}`,
    `電話番号：${phone || "（未入力）"}`,
    "",
    "メッセージ：",
    message || "（未入力）",
    "",
    `送信日時：${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
  ].join("\n");

  const from = env.FROM_ADDRESS;
  const to = env.TO_ADDRESS;
  const domain = from.split("@")[1];
  const raw = [
    `From: ${encodedWord("西条インターン.com")} <${from}>`,
    `To: ${to}`,
    `Reply-To: ${email}`,
    `Subject: ${encodedWord(`【インターン応募】${name}さん`)}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(body).replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");

  try {
    await env.MAIL.send(new EmailMessage(from, to, raw));
  } catch (error) {
    console.error("mail send failed", error);
    return json({ ok: false, error: "send_failed" }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/apply") {
      if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
      return handleApply(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
