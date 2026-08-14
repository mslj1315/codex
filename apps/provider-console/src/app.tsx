import { FormEvent, useEffect, useState } from 'react';
import { createOperatorApi, OperatorApiError, type OperatorApi } from './api';
import { createSessionStore, type OperatorSession } from './session';

const defaultApi = createOperatorApi(createSessionStore());

export function App({ api = defaultApi }: { api?: OperatorApi }) {
  const [session, setSession] = useState<OperatorSession>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void api.restoreSession().then((restored) => {
      if (active) setSession(restored);
    }).catch(() => {
      if (active) setError('无法恢复会话，请稍后重试。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => api.onSessionExpired(() => {
    setError(undefined);
    setSession(undefined);
  }), [api]);

  if (loading) return <main className="state">正在恢复会话...</main>;
  if (!session?.capabilities.operatorAdmin) return <Login api={api} error={error} onSession={(next) => { setError(undefined); setSession(next); }} />;
  return <ConsoleShell api={api} onExpired={() => setSession(undefined)} />;
}

function Login({ api, error: initialError, onSession }: { api: OperatorApi; error?: string; onSession(session: OperatorSession): void }) {
  const [accountId, setAccountId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      onSession(await api.login(accountId, password));
      setPassword('');
    } catch (cause) {
      setError(cause instanceof OperatorApiError && cause.status === 403 ? '账号或密码无效。' : '登录失败，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-page"><form className="login-form" onSubmit={submit}>
    <h1>内容运营后台</h1>
    <label>账号<input name="accountId" autoComplete="username" value={accountId} onChange={(event) => setAccountId(event.target.value)} required /></label>
    <label>密码<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={submitting}>{submitting ? '登录中...' : '登录'}</button>
  </form></main>;
}

function ConsoleShell({ api, onExpired }: { api: OperatorApi; onExpired(): void }) {
  const [view, setView] = useState<'templates' | 'rules'>('templates');
  const [error, setError] = useState<string>();
  async function logout() {
    try { await api.logout(); onExpired(); } catch (cause) {
      if (cause instanceof OperatorApiError && cause.status === 403) onExpired();
      else setError('退出登录失败，请稍后重试。');
    }
  }
  return <div className="console-shell">
    <aside><strong>内容运营</strong><nav aria-label="运营导航"><button className={view === 'templates' ? 'selected' : ''} onClick={() => setView('templates')}>模板库</button><button className={view === 'rules' ? 'selected' : ''} onClick={() => setView('rules')}>审核规则</button></nav><button onClick={() => void logout()}>退出登录</button></aside>
    <main className="workspace"><header><p>内部内容库</p><h1>{view === 'templates' ? '模板库' : '审核规则'}</h1></header>{error && <p role="alert">{error}</p>}<section className="empty-state">{view === 'templates' ? '模板列表将在此处显示。' : '审核规则将在此处显示。'}</section></main>
  </div>;
}
