import React, { useEffect, useRef, useState } from 'react';
import {
  cloudURL,
  connectGitHub,
  DEFAULT_CLOUD_CONFIG,
  listCloudProjects,
  writeCloudProject,
} from './cloudStorage.js';
import { GITHUB_AUTH_URL, signInToGitHub } from './githubSignIn.js';
import './cloud-projects.css';

function sameRepository(a, b) {
  return a && b && a.owner === b.owner && a.repo === b.repo && a.branch === b.branch;
}
const date = (value) => (value ? new Date(value).toLocaleString('ja-JP') : '日時不明');

export default function CloudProjects({
  project,
  session,
  onSession,
  currentFile,
  pending,
  initialError,
  onOpen,
  onSaved,
  onClose,
  Modal,
  Button,
}) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(initialError || '');
  const [message, setMessage] = useState('');
  const [name, setName] = useState(project.name);
  const [ready, setReady] = useState(false);
  const [sharedURL, setSharedURL] = useState('');
  const active =
    session?.expiresAt > Date.now() && sameRepository(session.config, DEFAULT_CLOUD_CONFIG)
      ? session
      : null;
  const connection = active || { config: DEFAULT_CLOUD_CONFIG, token: '', canWrite: false };
  const canOverwrite =
    active?.canWrite && sameRepository(currentFile?.config, DEFAULT_CLOUD_CONFIG);

  async function run(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refresh(value) {
    setReady(false);
    const list = await listCloudProjects(value.config, value.token);
    setFiles(list);
    setReady(true);
  }
  useEffect(() => {
    run(() => refresh(connection));
  }, []);

  async function copy(url) {
    setSharedURL(url);
    try {
      await navigator.clipboard.writeText(url);
      setMessage('URLをコピーしました');
    } catch {
      setError('URLをコピーできません。表示されているURLを選択してコピーしてください');
    }
  }
  const url = sharedURL || (currentFile ? cloudURL(currentFile.config, currentFile.path) : '');
  return (
    <Modal
      title="クラウド保存・保存リスト"
      subtitle="このリポジトリに画像・建築・全プラン・表示設定を保存します。"
      wide
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
    >
      <div className="cloud-connected">
        <div>
          <strong>
            {DEFAULT_CLOUD_CONFIG.owner}/{DEFAULT_CLOUD_CONFIG.repo}
          </strong>
          <small>{DEFAULT_CLOUD_CONFIG.branch} / ma-projects · 公開</small>
        </div>
        {active ? (
          <Button
            disabled={busy}
            onClick={() => {
              onSession(null);
              setMessage('ログアウトしました');
            }}
          >
            ログアウト
          </Button>
        ) : (
          <Button
            className="primary"
            disabled={busy || !GITHUB_AUTH_URL}
            onClick={() =>
              run(async () => {
                const identity = await signInToGitHub();
                const authenticated = {
                  ...(await connectGitHub(DEFAULT_CLOUD_CONFIG, identity.token)),
                  ...identity,
                };
                if (!authenticated.canWrite)
                  throw new Error('このGitHubアカウントには保存権限がありません');
                onSession(authenticated);
                await refresh(authenticated);
                if (pending && sameRepository(pending.config, DEFAULT_CLOUD_CONFIG))
                  await onOpen(pending.path, authenticated);
              })
            }
          >
            GitHubでログイン
          </Button>
        )}
      </div>
      <p className="field-note">
        {active
          ? `${active.login} としてログイン中。`
          : '保存リストから開く操作はログイン不要です。保存するときはGitHubでログインしてください。'}{' '}
        保存はこのリポジトリに書き込み権限のある人だけが実行できます。作品・画像と上書き前の履歴も公開されます。
      </p>
      {!GITHUB_AUTH_URL && (
        <p className="form-error" role="alert">
          GitHubログインは管理者による認証サーバーの設定待ちです。保存リストの閲覧とJSONの書き出しは利用できます。
        </p>
      )}
      <div className="cloud-save">
        <label>
          新しい保存名
          <input
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="cloud-actions">
          <Button
            className="primary"
            disabled={busy || !active?.canWrite || !name.trim()}
            onClick={() =>
              run(async () => {
                const file = await writeCloudProject(active.config, active.token, project, name);
                onSaved(file);
                setSharedURL('');
                setMessage('別の保存として保存しました');
                await refresh(active);
              })
            }
          >
            別名で保存
          </Button>
          <Button
            disabled={busy || !canOverwrite}
            onClick={() =>
              run(async () => {
                const file = await writeCloudProject(
                  active.config,
                  active.token,
                  project,
                  currentFile.name,
                  currentFile,
                );
                onSaved(file);
                setMessage('上書き保存しました');
                await refresh(active);
              })
            }
          >
            上書き保存
          </Button>
        </div>
        <p className="field-note">
          {canOverwrite
            ? `上書き先：${currentFile.name}`
            : '上書き保存は、GitHubログイン後に保存リストから開くか、別名で保存した後に使えます。'}
        </p>
      </div>
      <div className="cloud-list-heading">
        <h3>保存リスト {ready ? `（${files.length}件）` : ''}</h3>
        <Button disabled={busy} onClick={() => run(() => refresh(connection))}>
          一覧を更新
        </Button>
      </div>
      <div className="cloud-list" aria-label="GitHubの保存リスト" aria-busy={busy}>
        {files.map((file) => (
          <article
            key={file.path}
            className={
              currentFile?.path === file.path &&
              sameRepository(currentFile?.config, DEFAULT_CLOUD_CONFIG)
                ? 'current'
                : ''
            }
          >
            <div>
              <strong>{file.name}</strong>
              <small>
                作成 {date(file.createdAt)} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </small>
            </div>
            <Button
              disabled={busy}
              aria-label={`${file.name}を開く`}
              onClick={() => run(() => onOpen(file.path, connection))}
            >
              開く
            </Button>
            <Button
              disabled={busy}
              aria-label={`${file.name}のURLをコピー`}
              onClick={() => copy(cloudURL(DEFAULT_CLOUD_CONFIG, file.path))}
            >
              URL
            </Button>
          </article>
        ))}
        {ready && !files.length && (
          <p className="empty-small">
            保存はまだありません。GitHubログイン後に「別名で保存」で追加できます。
          </p>
        )}
        {!ready && !error && <p className="field-note">保存リストを読み込んでいます…</p>}
      </div>
      {url && (
        <div className="cloud-share">
          <label>
            {sharedURL ? '共有する保存のURL' : '現在開いている保存のURL'}
            <input
              aria-label="保存状態のURL"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <Button onClick={() => copy(url)}>URLをコピー</Button>
          <p className="field-note">
            上書き保存後も同じURLで最新の保存状態を開けます。未保存の編集はURLに反映されません。
          </p>
        </div>
      )}
      {busy && (
        <p role="status" className="field-note">
          GitHubと通信中…
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="cloud-message">
          {message}
        </p>
      )}
    </Modal>
  );
}
