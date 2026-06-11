import { ensureAnonymousUser } from "../lib/firebase.js";

const chatFunctionUrl = import.meta.env.VITE_CHAT_FUNCTION_URL;

function requireChatFunctionUrl() {
  if (!chatFunctionUrl) {
    throw new Error(
      "Cloud FunctionsのURLが未設定です。frontend/.env の VITE_CHAT_FUNCTION_URL を確認してください。",
    );
  }
}

export async function requestAssistantReply({
  message,
  history,
  conversationId,
  signal,
}) {
  requireChatFunctionUrl();

  const user = await ensureAnonymousUser();
  const idToken = await user.getIdToken();

  const response = await fetch(chatFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      message,
      history,
      conversationId,
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `通信に失敗しました。HTTP ${response.status}`);
  }

  if (!data.reply || typeof data.reply !== "string") {
    throw new Error("AIの返答を正しく受け取れませんでした。");
  }

  return data;
}
