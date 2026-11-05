import React, { useEffect, useRef, useState } from 'react';
import { cloudURL, connectGitHub, listCloudProjects, writeCloudProject } from './cloudStorage.js';
import './cloud-projects.css';

const SETTINGS_KEY = 'ma:github-settings';
function savedSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}
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
  const [config, setConfig] = useState(
    () => pending?.config || session?.config || currentFile?.config || savedSettings(),
  );
  const [token, setToken] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(initialError || '');
  const [message, setMessage] = useState('');
  const [name, setName] = useState(project.name);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(!session);
  const [sharedURL, setSharedURL] = useState('');
  const active = session && sameRepository(session.config, config) && !editing ? session : null;
  const canOverwrite = active?.canWrite && sameRepository(currentFile?.config, active.config);

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
  async function refresh(connection) {
    setReady(false);
    const list = await listCloudProjects(connection.config, connection.token);
    setFiles(list);
    setReady(true);
  }
  useEffect(() => {
    if (active) run(() => refresh(active));
  }, [active?.config.owner, active?.config.repo, active?.config.branch, editing]);

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
      subtitle="GitHubに画像・建築・全プラン・表示設定を保存します。"
      wide
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
    >
      {!active ? (
        <form
          className="cloud-connection"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const connection = {
                ...(await connectGitHub(config, token.trim())),
                token: token.trim(),
              };
              setConfig(connection.config);
              onSession(connection);
              setToken('');
              setEditing(false);
              try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(connection.config));
              } catch {}
              await refresh(connection);
              if (pending && sameRepository(pending.config, connection.config))
                await onOpen(pending.path, connection);
            });
          }}
        >
          <p className="field-note">
            保存用リポジトリを指定します。公開リポジトリでは作品画像も公開されます。非公開で保管する場合は、Privateのリポジトリを使ってください。
          </p>
          <div className="cloud-fields">
            <label>
              所有者（ユーザー／組織）
              <input
                required
                value={config.owner || ''}
                placeholder="例：nbbbnbbb"
                disabled={busy}
                onChange={(e) => setConfig({ ...config, owner: e.target.value })}
              />
            </label>
            <label>
              リポジトリ名
              <input
                required
                value={config.repo || ''}
                placeholder="例：exhibition-saves"
                disabled={busy}
                onChange={(e) => setConfig({ ...config, repo: e.target.value })}
              />
            </label>
            <label>
              ブランチ
              <input
                value={config.branch || ''}
                placeholder="空欄なら既定のブランチ"
                disabled={busy}
                onChange={(e) => setConfig({ ...config, branch: e.target.value })}
              />
            </label>
            <label>
              GitHubトークン
              <input
                type="password"
                value={token}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                placeholder="公開データの読み込みだけなら不要"
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          </div>
          <p className="field-note">
            保存には、対象リポジトリの Contents: Read and write 権限を持つ Fine-grained token
            が必要です。トークンはこのタブのメモリーだけに保持し、終了・再読み込みで消えます。
          </p>
          <div className="cloud-actions">
            <Button className="primary" disabled={busy} type="submit">
              {busy ? '接続中…' : pending ? '接続してURLの保存を開く' : '接続する'}
            </Button>
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
            >
              トークンを作成
            </a>
            <a href="https://github.com/new" target="_blank" rel="noreferrer">
              保存用リポジトリを作成
            </a>
          </div>
          <p className="field-note">
            新しいリポジトリは「Add a README」を有効にして作成してください。
          </p>
        </form>
      ) : (
        <>
          <div className="cloud-connected">
            <div>
              <strong>
                {active.config.owner}/{active.config.repo}
              </strong>
              <small>
                {active.config.branch} / ma-projects · {active.private ? '非公開' : '公開'}
                {active.canWrite ? '' : ' · 読み込みのみ'}
              </small>
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                onSession(null);
                setEditing(true);
                setReady(false);
                setFiles([]);
              }}
            >
              接続設定を変更
            </Button>
          </div>
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
                disabled={busy || !active.canWrite || !name.trim()}
                onClick={() =>
                  run(async () => {
                    const file = await writeCloudProject(
                      active.config,
                      active.token,
                      project,
                      name,
                    );
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
                : '上書き保存は、保存リストから開くか、別名で保存した後に使えます。'}
            </p>
          </div>
          <div className="cloud-list-heading">
            <h3>保存リスト {ready ? `（${files.length}件）` : ''}</h3>
            <Button disabled={busy} onClick={() => run(() => refresh(active))}>
              一覧を更新
            </Button>
          </div>
          <div className="cloud-list" aria-label="GitHubの保存リスト" aria-busy={busy}>
            {files.map((file) => (
              <article
                key={file.path}
                className={
                  currentFile?.path === file.path &&
                  sameRepository(currentFile?.config, active.config)
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
                  onClick={() => run(() => onOpen(file.path, active))}
                >
                  開く
                </Button>
                <Button
                  disabled={busy}
                  aria-label={`${file.name}のURLをコピー`}
                  onClick={() => copy(cloudURL(active.config, file.path))}
                >
                  URL
                </Button>
              </article>
            ))}
            {ready && !files.length && (
              <p className="empty-small">保存はまだありません。「別名で保存」で追加できます。</p>
            )}
            {!ready && !error && <p className="field-note">保存リストを読み込んでいます…</p>}
          </div>
        </>
      )}
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
            上書き保存後も同じURLで最新の保存状態を開けます。非公開データは開く側にもトークンが必要です。未保存の編集はURLに反映されません。
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
