import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonymousUser } from "./lib/firebase.js";
import { requestAssistantReply } from "./services/chatService.js";

const INITIAL_ASSISTANT_MESSAGE =
  "こんにちは。きずなちゃんです。今日はどんな一日でしたか？";

const AVATAR_STATES = {
  Idling: {
    label: "待機中",
    guide: "こんにちは。お話ししましょう",
    emoji: "😊",
    card: "from-sky-100 via-white to-amber-50 border-sky-200 shadow-sky-100",
    badge: "bg-sky-100 text-sky-800 border-sky-200",
    avatarMotion: "",
  },
  Listening: {
    label: "お話を聴いています",
    guide: "ゆっくりお話しください",
    emoji: "👂",
    card: "from-emerald-100 via-white to-green-50 border-green-300 shadow-green-100",
    badge: "bg-green-100 text-green-800 border-green-200",
    avatarMotion: "animate-pulse",
  },
  Thinking: {
    label: "考えています",
    guide: "少しお待ちください",
    emoji: "🤔",
    card: "from-amber-100 via-white to-yellow-50 border-amber-300 shadow-amber-100",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    avatarMotion: "animate-pulse",
  },
  Speaking: {
    label: "きずなちゃんがお話ししています",
    guide: "聞いてくださいね",
    emoji: "🗣️",
    card: "from-pink-100 via-white to-rose-50 border-pink-300 shadow-pink-100",
    badge: "bg-pink-100 text-pink-800 border-pink-200",
    avatarMotion: "animate-bounce",
  },
};

function createConversationId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function App() {
  const [avatarState, setAvatarState] = useState("Idling");
  const [conversationId] = useState(createConversationId);
  const [conversation, setConversation] = useState([
    { role: "assistant", content: INITIAL_ASSISTANT_MESSAGE },
  ]);
  const [latestAssistantText, setLatestAssistantText] = useState(
    INITIAL_ASSISTANT_MESSAGE,
  );
  const [latestUserText, setLatestUserText] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [authStatus, setAuthStatus] = useState("準備中");
  const [isSpeechRecognitionSupported, setIsSpeechRecognitionSupported] =
    useState(true);

  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef("");
  const sendMessageRef = useRef(null);
  const abortControllerRef = useRef(null);

  const currentAvatar = useMemo(
    () => AVATAR_STATES[avatarState],
    [avatarState],
  );

  const isListening = avatarState === "Listening";
  const isThinking = avatarState === "Thinking";
  const isSpeaking = avatarState === "Speaking";
  const isBusy = isThinking || isSpeaking;

  useEffect(() => {
    let active = true;

    ensureAnonymousUser()
      .then(() => {
        if (active) setAuthStatus("接続済み");
      })
      .catch((error) => {
        console.error(error);
        if (active) {
          setAuthStatus("接続エラー");
          setErrorMessage(
            "アプリの初期設定に接続できませんでした。少し待ってから再読み込みしてください。",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const speakText = useCallback((text) => {
    return new Promise((resolve) => {
      if (!text || !("speechSynthesis" in window)) {
        setAvatarState("Idling");
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ja-JP";
      utterance.rate = 0.88;
      utterance.pitch = 1.04;
      utterance.volume = 1;

      const japaneseVoice = window.speechSynthesis
        .getVoices()
        .find((voice) => voice.lang?.toLowerCase().startsWith("ja"));

      if (japaneseVoice) utterance.voice = japaneseVoice;

      utterance.onstart = () => setAvatarState("Speaking");
      utterance.onend = () => {
        setAvatarState("Idling");
        resolve();
      };
      utterance.onerror = () => {
        setAvatarState("Idling");
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const sendMessage = useCallback(
    async (rawText) => {
      const text = rawText.trim();
      if (!text || isBusy) return;

      setErrorMessage("");
      setLatestUserText(text);
      setInterimTranscript("");
      setAvatarState("Thinking");

      const userMessage = { role: "user", content: text };
      const nextHistory = [...conversation, userMessage];
      setConversation(nextHistory);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const data = await requestAssistantReply({
          message: text,
          history: conversation.slice(-10),
          conversationId,
          signal: abortControllerRef.current.signal,
        });

        const assistantMessage = { role: "assistant", content: data.reply };
        setLatestAssistantText(data.reply);
        setConversation((current) => [...current, assistantMessage]);
        await speakText(data.reply);
      } catch (error) {
        if (error.name === "AbortError") return;

        console.error(error);
        const fallbackMessage =
          "うまくお話しできませんでした。もう一度、ゆっくりお話しください。";

        setErrorMessage(error.message);
        setLatestAssistantText(fallbackMessage);
        setConversation((current) => [
          ...current,
          { role: "assistant", content: fallbackMessage },
        ]);
        await speakText(fallbackMessage);
      }
    },
    [conversation, conversationId, isBusy, speakText],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSpeechRecognitionSupported(false);
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      finalTranscriptRef.current = "";
      setInterimTranscript("");
      setLatestUserText("");
      setErrorMessage("");
      setAvatarState("Listening");
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += transcript;
        else interim += transcript;
      }

      if (finalText) finalTranscriptRef.current += finalText;
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      if (event.error === "not-allowed") {
        setErrorMessage(
          "マイクの利用が許可されていません。ブラウザの設定をご確認ください。",
        );
      } else if (event.error === "no-speech") {
        setErrorMessage("声を聞き取れませんでした。もう一度お話しください。");
      } else {
        setErrorMessage(
          "音声認識で問題が発生しました。もう一度お試しください。",
        );
      }

      setAvatarState("Idling");
    };

    recognition.onend = () => {
      const finalText = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = "";
      setInterimTranscript("");

      if (finalText) sendMessageRef.current?.(finalText);
      else setAvatarState("Idling");
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      window.speechSynthesis?.cancel();
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleTalkButton = () => {
    setErrorMessage("");

    if (!isSpeechRecognitionSupported) {
      setErrorMessage(
        "このブラウザでは音声認識を利用できません。下の文字入力をご利用ください。",
      );
      return;
    }

    if (isBusy) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    window.speechSynthesis?.cancel();

    try {
      recognitionRef.current?.start();
    } catch (error) {
      console.error(error);
      setErrorMessage(
        "マイクを開始できませんでした。少し待ってから、もう一度お試しください。",
      );
      setAvatarState("Idling");
    }
  };

  const handleStopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setAvatarState("Idling");
  };

  const handleManualSubmit = async (event) => {
    event.preventDefault();
    const text = manualText.trim();
    if (!text || isBusy) return;

    setManualText("");
    await sendMessage(text);
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-800 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-3xl flex-col">
        <header className="mb-4 text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-2xl text-white shadow-md">
              ♡
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900 sm:text-4xl">
              Kizuna AI Care
            </h1>
          </div>
          <p className="text-base font-medium text-slate-600 sm:text-lg">
            きずなちゃんと、ゆっくりお話ししましょう
          </p>
        </header>

        <section
          className={`flex flex-1 flex-col rounded-[2rem] border-4 bg-gradient-to-br p-5 shadow-xl transition-all duration-500 sm:p-8 ${currentAvatar.card}`}
        >
          <div className="mb-5 text-center" aria-live="polite">
            <span
              className={`inline-flex items-center rounded-full border px-5 py-2 text-base font-bold sm:text-lg ${currentAvatar.badge}`}
            >
              {currentAvatar.label}
            </span>
            <p className="mt-3 text-xl font-bold text-slate-700 sm:text-2xl">
              {currentAvatar.guide}
            </p>
          </div>

          <div className="flex flex-1 items-center justify-center py-4">
            <div
              className={`flex h-52 w-52 items-center justify-center rounded-full border-8 border-white bg-white/80 text-8xl shadow-lg transition-all duration-500 sm:h-64 sm:w-64 sm:text-9xl ${currentAvatar.avatarMotion}`}
              aria-label={`アバターの状態: ${currentAvatar.label}`}
            >
              {currentAvatar.emoji}
            </div>
          </div>

          <div
            className="mb-5 rounded-3xl border border-white/80 bg-white/90 px-5 py-5 text-center shadow-sm"
            aria-live="polite"
          >
            <p className="mb-2 text-sm font-bold text-blue-700">きずなちゃん</p>
            <p className="text-xl font-bold leading-relaxed text-slate-800 sm:text-2xl">
              {latestAssistantText}
            </p>
          </div>

          {(interimTranscript || latestUserText) && (
            <div className="mb-5 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-center">
              <p className="mb-1 text-sm font-bold text-slate-500">あなたのお話</p>
              <p className="text-lg font-medium text-slate-700">
                {interimTranscript || latestUserText}
              </p>
            </div>
          )}

          {errorMessage && (
            <div
              className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-base font-bold text-red-700"
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleTalkButton}
              disabled={isBusy || authStatus === "準備中"}
              className={`flex min-h-24 w-full max-w-xl items-center justify-center rounded-3xl px-6 py-5 text-2xl font-bold text-white shadow-lg transition-all duration-200 sm:text-3xl ${
                isListening
                  ? "bg-red-500 hover:bg-red-600"
                  : isBusy || authStatus === "準備中"
                    ? "cursor-not-allowed bg-slate-400"
                    : "bg-blue-700 hover:bg-blue-800 active:scale-[0.98]"
              }`}
            >
              {isListening && "■ お話を送る"}
              {isThinking && "考えています…"}
              {isSpeaking && "お話ししています…"}
              {avatarState === "Idling" && authStatus !== "準備中" && "🎤 お話しする"}
              {avatarState === "Idling" && authStatus === "準備中" && "準備しています…"}
            </button>

            {isSpeaking && (
              <button
                type="button"
                onClick={handleStopSpeaking}
                className="rounded-full border-2 border-slate-300 bg-white px-6 py-3 text-lg font-bold text-slate-700 shadow-sm transition hover:bg-slate-100"
              >
                ■ 読み上げを止める
              </button>
            )}

            <p className="text-center text-sm font-medium text-slate-500 sm:text-base">
              ボタンを押してから、ゆっくりお話しください
            </p>
          </div>
        </section>

        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-center font-bold text-slate-600">
            文字で入力する
          </summary>
          <form onSubmit={handleManualSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder="例：今日は散歩に行きました"
              className="min-h-14 flex-1 rounded-xl border-2 border-slate-200 px-4 text-lg outline-none transition focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={!manualText.trim() || isBusy}
              className="min-h-14 rounded-xl bg-blue-700 px-6 text-lg font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              送信
            </button>
          </form>
        </details>

        <footer className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          <p>接続状態: {authStatus}</p>
          <p>緊急時や体調に異変がある場合は、家族や医療機関へご連絡ください。</p>
        </footer>
      </div>
    </main>
  );
}

export default App;
