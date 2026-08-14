import { useEffect, useState } from 'react';
import { OperatorApiError, type OperatorApi } from '../api';
import { RuleEditor } from './rule-editor';
import type { Rule, RuleInput } from './types';

export function RuleList({ api }: { api: Pick<OperatorApi, 'request'> }) {
  const [items, setItems] = useState<Rule[]>([]); const [selected, setSelected] = useState<Rule>(); const [versions, setVersions] = useState<Rule[]>([]); const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading'); const [message, setMessage] = useState<string>();
  async function load() { setState('loading'); try { const result = await api.request('GET', '/v1/operator-content/rules'); setItems(Array.isArray(result) ? result as Rule[] : []); setState('ready'); } catch (cause) { setState(cause instanceof OperatorApiError || (typeof cause === 'object' && cause !== null && 'status' in cause && (cause as { status: unknown }).status === 403) ? 'forbidden' : 'failed'); } }
  useEffect(() => { void load(); }, []);
  async function choose(item: Rule) { setSelected(item); try { setVersions(await api.request('GET', `/v1/operator-content/rules/${item.logicalId}/versions`) as Rule[]); } catch { setMessage('Unable to load version history.'); } }
  async function save(id: string | undefined, input: RuleInput) { const item = id ? await api.request('PUT', `/v1/operator-content/rules/${id}/draft`, input) as Rule : await api.request('POST', '/v1/operator-content/rules', input) as Rule; await load(); await choose(item); setMessage('Draft saved.'); }
  async function transition(action: 'publish' | 'disable', id: string, version: number) { const item = await api.request('POST', `/v1/operator-content/rules/${id}/versions/${version}/${action}`) as Rule; await load(); await choose(item); setMessage(action === 'publish' ? 'Version published.' : 'Version disabled.'); }
  if (state === 'loading') return <p className="state">Loading review rules...</p>;
  if (state === 'forbidden') return <section className="state"><p>Access is unavailable.</p><button onClick={() => void load()}>Retry</button></section>;
  if (state === 'failed') return <section className="state"><p>Review rules could not be loaded.</p><button onClick={() => void load()}>Retry</button></section>;
  const preview = (rule: RuleInput, text: string) => api.request('POST', '/v1/operator-content/rules/preview', { rule, text }) as Promise<{ matches?: Array<{ pattern: string; guidance: string }> }>;
  return <div className="content-manager"><section className="library-list"><div className="list-heading"><h2>Review rules</h2><button onClick={() => { setSelected(undefined); setVersions([]); }}>New rule</button></div>{items.length === 0 ? <p>No review rules yet.</p> : <ul>{items.map((item) => <li key={item.logicalId}><button className={selected?.logicalId === item.logicalId ? 'selected' : ''} onClick={() => void choose(item)}><span>{item.name}</span><small>v{item.version} · {item.status}</small></button></li>)}</ul>}</section><section className="detail"><h2>{selected ? `${selected.name} v${selected.version}` : 'New rule'}</h2>{message && <p role="status">{message}</p>}<RuleEditor rule={selected} onSave={save} onPublish={(id, version) => transition('publish', id, version)} onDisable={(id, version) => transition('disable', id, version)} onPreview={preview} />{versions.length > 0 && <section aria-label="Rule version history"><h3>Version history</h3><ul>{versions.map((item) => <li key={item.version}>v{item.version} · {item.status}</li>)}</ul></section>}</section></div>;
}
