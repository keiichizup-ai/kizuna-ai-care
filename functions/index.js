const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const OpenAI = require("openai");

initializeApp();

const db = getFirestore();
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const openAiModel = defineString("OPENAI_MODEL", { default: "gpt-4o" });

const SYSTEM_PROMPT = `
あなたの名前は「きずなちゃん」です。高齢者の話し相手となるAIコンパニオンです。
以下のルールを厳格に守って対話してください。
1. 返答は常に1〜2文、原則50文字以内で、簡潔かつ分かりやすく返してください。
2. 専門用語は使わず、小学生でもわかる言葉を選んでください。
3. 相手を否定せず、常に共感を示してください。
4. 過去の思い出、故郷、好きだった遊び、季節の出来事などを優しく引き出す質問を適度に織り交ぜてください。
5. 医療診断、治療判断、緊急対応の代替はしないでください。体調不良や危険を示す発言には、家族や医療機関、緊急窓口へ連絡するよう短く促してください。
`.trim();

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-10)
    .filter(
      (item) =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string",
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 500),
    }))
    .filter((item) => item.content.length > 0);
}

async function verifyUser(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match) {
    throw new Error("AUTH_TOKEN_MISSING");
  }

  return getAuth().verifyIdToken(match[1]);
}

async function saveConversation({ uid, conversationId, message, reply }) {
  const userRef = db.collection("users").doc(uid);
  const conversationRef = db.collection("conversations").doc(conversationId);
  const messagesRef = conversationRef.collection("messages");

  await db.runTransaction(async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);

    transaction.set(
      userRef,
      {
        userId: uid,
        lastActiveAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const conversationData = {
      userId: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!conversationSnapshot.exists) {
      conversationData.createdAt = FieldValue.serverTimestamp();
    }

    transaction.set(conversationRef, conversationData, { merge: true });

    transaction.set(messagesRef.doc(), {
      role: "user",
      content: message,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(messagesRef.doc(), {
      role: "assistant",
      content: reply,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

exports.chat = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 10,
    secrets: [openAiApiKey],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "POSTメソッドを使用してください。" });
      return;
    }

    try {
      const decodedToken = await verifyUser(request);
      const message = String(request.body?.message || "").trim();
      const conversationId = String(request.body?.conversationId || "").trim();
      const history = sanitizeHistory(request.body?.history);

      if (!message) {
        sendJson(response, 400, { error: "メッセージを入力してください。" });
        return;
      }

      if (message.length > 500) {
        sendJson(response, 400, { error: "メッセージが長すぎます。短くしてお話しください。" });
        return;
      }

      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(conversationId)) {
        sendJson(response, 400, { error: "会話IDが正しくありません。" });
        return;
      }

      const client = new OpenAI({ apiKey: openAiApiKey.value() });
      const completion = await client.chat.completions.create({
        model: openAiModel.value(),
        temperature: 0.7,
        max_tokens: 120,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message },
        ],
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        throw new Error("EMPTY_AI_RESPONSE");
      }

      await saveConversation({
        uid: decodedToken.uid,
        conversationId,
        message,
        reply,
      });

      sendJson(response, 200, { reply, conversationId });
    } catch (error) {
      console.error(error);

      if (error.message === "AUTH_TOKEN_MISSING") {
        sendJson(response, 401, { error: "認証情報がありません。" });
        return;
      }

      if (error.code?.startsWith("auth/")) {
        sendJson(response, 401, { error: "認証に失敗しました。" });
        return;
      }

      sendJson(response, 500, {
        error: "会話の処理に失敗しました。少し待ってから、もう一度お試しください。",
      });
    }
  },
);
