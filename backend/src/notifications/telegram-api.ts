export type TelegramSendResult =
  | { ok: true }
  | { ok: false; description: string };

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let body: unknown;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    body = await res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { ok: false, description: msg };
  }
  const data = body as { ok?: boolean; description?: string };
  if (data.ok === true) return { ok: true };
  return {
    ok: false,
    description: typeof data.description === 'string' ? data.description : 'Unknown Telegram error',
  };
}
