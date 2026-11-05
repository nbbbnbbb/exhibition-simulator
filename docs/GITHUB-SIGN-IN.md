# GitHubログインの設置

アプリ本体はGitHub Pages、保存先は `nbbbnbbb/exhibition-simulator` の `ma-saves` ブランチ、認証コードの交換だけをVercelのNode.js Functionで実行します。利用者はGitHubでログインし、トークンを手入力しません。

## 管理者による初回設定

1. Vercelにこのリポジトリをインポートし、Root Directoryを `auth-server`、Framework PresetをOtherにします。実装を準備中のブランチで確認する場合は、そのブランチからデプロイしてください。Output Directoryは `public` です。サーバーの公開HTTPS URLを確認します。
2. GitHubの Settings → Developer settings → GitHub Apps → New GitHub App でアプリを登録します。
   - Homepage URL：`https://nbbbnbbb.github.io/exhibition-simulator/`
   - Callback URL：`https://<認証サーバーのドメイン>/api/callback`
   - Webhook：無効
   - Repository permissions：ContentsはRead and write、MetadataはRead-only。他の権限は付けません。
   - 利用者の有効期限付きトークンを有効にします。サーバーは期限のないトークンを拒否します。
   - 他の共同編集者も認証する場合は公開GitHub Appにします。公開アプリでも、保存にはこのリポジトリへの書き込み権限が必要です。
3. GitHub Appを `nbbbnbbb/exhibition-simulator` **だけ**にインストールします。All repositoriesを選ぶ必要はありません。
4. VercelのプロジェクトのEnvironment Variablesへ、次の値を登録します。値はチャットやGitへ貼らず、Vercel側に設定します。

   | 名前 | 値 |
   | --- | --- |
   | `GITHUB_APP_CLIENT_ID` | GitHub AppのClient ID（App IDとは異なります） |
   | `GITHUB_APP_CLIENT_SECRET` | GitHub AppのClient Secret |
   | `OAUTH_STATE_KEY` | 暗号化用のランダム32バイトをbase64化した値 |
   | `AUTH_ORIGIN` | 認証サーバーのHTTPSオリジン。例：`https://example.vercel.app` |

   `OAUTH_STATE_KEY` は、管理者の手元で `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` を一度実行して生成します。`.env.example` はキー名だけを示す見本です。秘密を入れたファイルはコミットしません。

5. 環境変数を反映して認証サーバーを再デプロイします。サーバーのURLはログインできるよう一般アクセス可能にしますが、エンドポイントはログイン処理だけで、ファイル書き込みや任意URLへの中継機能は持ちません。
6. GitHubリポジトリの Settings → Secrets and variables → Actions → Variables へ **`MA_GITHUB_AUTH_URL`** を追加し、認証サーバーのHTTPSオリジンを設定します。これは公開URLであり秘密ではありません。Pagesのビルドに `VITE_GITHUB_AUTH_URL` として渡します。Client Secretや認証キーには `VITE_` を付けません。
7. 保存先 `ma-saves` ブランチを作成します。ブランチのルールで保存先への書き込みを拒否しないようにします。`main` の保護ルールを解除する必要はありません。
8. Pagesをビルド・公開し、管理者のGitHubアカウントでログインして別名保存・上書き保存を確認します。別の未ログインのブラウザーで共有URLが開けることも確認します。

## 保護している範囲

- 認証コードの交換はサーバー側で行い、Client Secretを公開ページに配信しません。
- ランダムなstate、PKCE S256、暗号化・認証付きのHttpOnly Cookieを使い、未開始・改ざん・期限切れのログインを拒否します。
- GitHubユーザーと対象リポジトリへの書き込み権限を確認し、短期のGitHub App利用者トークンだけを返します。GitHub Appの権限と利用者の権限の両方が適用されます。
- ブラウザーはログイン用ウィンドウ・認証サーバーのオリジン・要求stateが一致した応答だけを受け付けます。認証情報をURLへ付けません。
- 認証応答はno-store、Referrer-Policy、CSPを設定します。更新用のrefresh tokenはブラウザーへ渡しません。
- 認証情報はブラウザーのタブ内だけで保持します。ログアウト・再読み込み・期限切れで破棄します。共通の管理者トークンを利用者へ渡しません。
- ファイルの更新は読み込み時のSHAを使い、他の人の変更を無条件に上書きしません。

公開保存のため作品・画像と履歴は誰でも読めます。ブラウザーのXSSや端末の侵害は利用者トークンの漏えいにつながるため、依存関係・アプリの変更・第三者スクリプトの追加は通常どおりレビューが必要です。認証サーバーの秘密が漏れた場合はClient Secretと認証キーを更新してください。

## 検証

`npm test` に認証の単体検証を含めます。`npm run test:cloud` は独立したテストビルドと模擬認証・GitHub APIを使い、トークン入力なしのログイン、保存、共有、権限拒否を確認します。実GitHub App・Vercelでのログインと保存は、初回設定後の実環境検証が別途必要です。

GitHub公式：[利用者トークンの生成](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[最小権限の選択](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)。Vercel公式：[Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[環境変数](https://vercel.com/docs/environment-variables)。
