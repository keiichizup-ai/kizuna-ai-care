# Kizuna AI Care - 会話機能 MVP

高齢者向けAI会話型見守りサービスの会話機能プロトタイプです。

## 実装済みの機能

- React + Vite + Tailwind CSSによるシングルページUI
- Web Speech APIによる音声認識（SpeechRecognition）
- Web Speech APIによる音声合成（SpeechSynthesis）
- アバター状態の切り替え: `Idling` / `Listening` / `Thinking` / `Speaking`
- Firebase Authenticationの匿名ログイン
- Firebase Cloud Functions v2を経由したOpenAI API呼び出し
- Cloud Firestoreへの会話履歴保存
- Firebase Hosting向け設定
- Firebase Emulator Suite向け設定

## フォルダ構成

```text
kizuna-ai-care/
├── .firebaserc.example
├── .gitignore
├── README.md
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
├── frontend/
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── index.css
│       ├── main.jsx
│       ├── lib/firebase.js
│       └── services/chatService.js
└── functions/
    ├── .secret.local.example
    ├── index.js
    └── package.json
```

## 1. 事前準備

以下をインストールしてください。

- Node.js 22
- npm
- Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

Firebase Consoleでプロジェクトを作り、次を有効にします。

1. Authentication > Sign-in method > Anonymous
2. Firestore Database
3. Firebase Hosting
4. Cloud Functions

Cloud Functionsをデプロイするため、FirebaseプロジェクトをBlazeプランへ変更する必要があります。

## 2. Firebaseプロジェクトを紐付ける

```bash
cp .firebaserc.example .firebaserc
```

`.firebaserc` の `YOUR_FIREBASE_PROJECT_ID` を実際のFirebaseプロジェクトIDへ置き換えます。

## 3. フロントエンドを設定する

Firebase Consoleの「プロジェクトの設定 > マイアプリ」でWebアプリを登録し、表示された値を使います。

```bash
cd frontend
cp .env.example .env
npm install
```

`frontend/.env` の各項目を実際の値へ置き換えます。

Cloud FunctionsのURLは、初回デプロイ後に表示されるURLへ置き換えてください。

## 4. Cloud Functionsを設定する

```bash
cd ../functions
npm install
cd ..
firebase functions:secrets:set OPENAI_API_KEY
```

コマンド実行後、OpenAI APIキーを入力します。APIキーはソースコードや `.env` に書かないでください。

モデル名はデフォルトで `gpt-4o` です。変更する場合は、デプロイ時にFirebase CLIから `OPENAI_MODEL` の値を設定します。

## 5. FirestoreルールとFunctionsをデプロイする

```bash
firebase deploy --only firestore:rules,functions
```

デプロイ完了後、ターミナルに表示された `chat` 関数のURLを `frontend/.env` の `VITE_CHAT_FUNCTION_URL` へ設定します。

## 6. ローカルで画面を確認する

```bash
cd frontend
npm run dev
```

ターミナルに表示されたURLをChromeで開きます。初回はマイク利用を許可してください。

## 7. Firebase Hostingへ公開する

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

## 8. Emulatorを使う場合

`frontend/.env` の設定を変更します。

```env
VITE_USE_FIREBASE_EMULATORS=true
VITE_CHAT_FUNCTION_URL=http://127.0.0.1:5001/YOUR_FIREBASE_PROJECT_ID/asia-northeast1/chat
```

ローカル用のOpenAI APIキーを準備します。

```bash
cp functions/.secret.local.example functions/.secret.local
```

`functions/.secret.local` の値を置き換えた後、プロジェクトルートで起動します。

```bash
firebase emulators:start
```

別のターミナルでフロントエンドを起動します。

```bash
cd frontend
npm run dev
```

## 補足 1

ブラウザ標準の音声認識はブラウザ差があります。まずはChromeで動作確認してください。音声認識非対応ブラウザでも、画面下部の文字入力で会話APIを確認できます。

正式なアバター画像を用意した後は、`frontend/src/App.jsx` の `emoji` を画像ファイルへ差し替えてください。

## 補足 2

Firebase上でデプロイが完了しています。ただし、モバイルブラウザでは動作しません。
https://kizuna-ai-care.web.app/
