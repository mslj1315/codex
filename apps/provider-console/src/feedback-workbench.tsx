import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderApiClient } from "./api";
import {
  listFeedback,
  type ActivityState,
  type FeedbackPage,
  type ProviderCustomerItem,
  type ProviderCustomerMetadata,
  type ReadinessState
} from "./feedback";
import { ProviderCustomerEditor } from "./provider-customer-editor";

type LoadState = "loading" | "ready" | "error" | "denied";
const noAuthenticationRequired = () => {};

export interface FeedbackWorkbenchProps {
  api: ProviderApiClient;
  onAuthenticationRequired?: () => void;
  canEditMetadata?: boolean;
}

export function FeedbackWorkbench({ api, onAuthenticationRequired = noAuthenticationRequired, canEditMetadata = false }: FeedbackWorkbenchProps) {
  const [activityState, setActivityState] = useState<ActivityState | "">("");
  const [readinessState, setReadinessState] = useState<ReadinessState | "">("");
  const [page, setPage] = useState<FeedbackPage>({ items: [], nextCursor: null });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [editingItem, setEditingItem] = useState<ProviderCustomerItem | null>(null);
  const [editingAvailable, setEditingAvailable] = useState(canEditMetadata);
  const pageGeneration = useRef(0);

  useEffect(() => {
    const generation = ++pageGeneration.current;
    let active = true;
    setLoadState("loading");
    setLoadingMore(false);
    setPage({ items: [], nextCursor: null });
    void listFeedback(api, {
      ...(activityState ? { activityState } : {}),
      ...(readinessState ? { readinessState } : {})
    }).then((loaded) => {
      if (!active || generation !== pageGeneration.current) return;
      setPage(loaded);
      setLoadState("ready");
    }).catch((error: unknown) => {
      if (!active || generation !== pageGeneration.current) return;
      const status = error instanceof Response ? error.status : 0;
      if (status === 401) {
        onAuthenticationRequired?.();
        return;
      }
      setLoadState(status === 403 ? "denied" : "error");
    });
    return () => { active = false; };
  }, [activityState, readinessState, api, onAuthenticationRequired, requestVersion]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return page.items;
    return page.items.filter((item) => [
      item.metadata?.customerAlias,
      item.feedback.enterpriseId,
      item.feedback.storeId
    ].filter(Boolean).join("\n").toLowerCase().includes(query));
  }, [page.items, search]);

  async function loadMore() {
    if (!page.nextCursor || loadingMore) return;
    const generation = pageGeneration.current;
    setLoadingMore(true);
    try {
      const next = await listFeedback(api, {
        ...(activityState ? { activityState } : {}),
        ...(readinessState ? { readinessState } : {}),
        cursor: page.nextCursor
      });
      if (generation === pageGeneration.current) {
        setPage((current) => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }));
      }
    } catch (error) {
      if (generation !== pageGeneration.current) return;
      const status = error instanceof Response ? error.status : 0;
      if (status === 401) onAuthenticationRequired?.();
      else setLoadState(status === 403 ? "denied" : "error");
    } finally {
      if (generation === pageGeneration.current) setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="customer-feedback-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Read-only aggregate view</p>
          <h1 id="customer-feedback-title">Customer Feedback</h1>
        </div>
      </div>

      <div className="feedback-controls">
        <label>Activity
          <select value={activityState} onChange={(event) => setActivityState(event.target.value as ActivityState | "")}>
            <option value="">All</option><option value="active">Active</option><option value="stale">Stale</option><option value="inactive">Inactive</option>
          </select>
        </label>
        <label>Readiness
          <select value={readinessState} onChange={(event) => setReadinessState(event.target.value as ReadinessState | "")}>
            <option value="">All</option><option value="ready">Ready</option><option value="incomplete">Incomplete</option><option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className="search-control">Current page search
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      {loadState === "loading" && <div className="feedback-loading" role="status">Loading customer feedback</div>}
      {loadState === "error" && <FeedbackError onRetry={() => setRequestVersion((version) => version + 1)} />}
      {loadState === "denied" && <div className="feedback-message">Feedback access is not available for this account.</div>}
      {loadState === "ready" && page.items.length === 0 && <div className="feedback-message">No customer feedback is available.</div>}
      {loadState === "ready" && page.items.length > 0 && visibleItems.length === 0 && <div className="feedback-message">No identifiers on this loaded page match your search.</div>}
      {loadState === "ready" && visibleItems.length > 0 && <FeedbackTable canEditMetadata={editingAvailable} items={visibleItems} onEdit={setEditingItem} />}
      {loadState === "ready" && page.nextCursor && (
        <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
          {loadingMore ? "Loading more" : "Load more"}
        </button>
      )}
      {editingItem && editingAvailable && (
        <ProviderCustomerEditor
          api={api}
          item={editingItem}
          onAuthenticationRequired={onAuthenticationRequired}
          onClosed={() => setEditingItem(null)}
          onReloadRequested={() => {
            setEditingItem(null);
            setRequestVersion((version) => version + 1);
          }}
          onEditingForbidden={() => {
            setEditingItem(null);
            setEditingAvailable(false);
          }}
          onSaved={(metadata) => {
            replaceMetadata(editingItem, metadata);
            setEditingItem(null);
          }}
        />
      )}
    </section>
  );

  function replaceMetadata(item: ProviderCustomerItem, metadata: ProviderCustomerMetadata | null) {
    setPage((current) => ({
      ...current,
      items: current.items.map((currentItem) => currentItem.feedback.enterpriseId === item.feedback.enterpriseId
        && currentItem.feedback.storeId === item.feedback.storeId
        ? { ...currentItem, metadata }
        : currentItem)
    }));
  }
}

function FeedbackError({ onRetry }: { onRetry(): void }) {
  return <div className="feedback-message" role="alert"><p>Customer feedback could not be loaded.</p><button onClick={onRetry} type="button">Retry</button></div>;
}

function FeedbackTable({
  items,
  canEditMetadata,
  onEdit
}: {
  items: ProviderCustomerItem[];
  canEditMetadata: boolean;
  onEdit(item: ProviderCustomerItem): void;
}) {
  return (
    <div className="feedback-table-wrap">
      <table className="feedback-table">
        <thead><tr><th>Customer</th><th>Latest activity</th><th>State</th><th>Diagnostics</th><th>Actions</th><th>Verification</th></tr></thead>
        <tbody>{items.map((item) => <FeedbackRow canEditMetadata={canEditMetadata} item={item} key={`${item.feedback.enterpriseId}\0${item.feedback.storeId}`} onEdit={onEdit} />)}</tbody>
      </table>
    </div>
  );
}

function FeedbackRow({ item, canEditMetadata, onEdit }: { item: ProviderCustomerItem; canEditMetadata: boolean; onEdit(item: ProviderCustomerItem): void }) {
  const feedback = item.feedback;
  return (
    <tr>
      <td>
        <strong>{item.metadata?.customerAlias ?? feedback.enterpriseId}</strong>
        {item.metadata?.customerAlias && <span>{feedback.enterpriseId}</span>}<span>{feedback.storeId}</span>
        {item.metadata?.providerNote && <p className="provider-note">{item.metadata.providerNote}</p>}
        {canEditMetadata && <button aria-label="Edit customer details" className="edit-customer-button" onClick={() => onEdit(item)} type="button"><span aria-hidden="true" className="edit-icon" />Edit</button>}
      </td>
      <td><span>Import {dateLabel(feedback.lastSuccessfulImportAt)}</span><span>Confirmed {dateLabel(feedback.lastConfirmedAt)}</span><span>Coverage {dateLabel(feedback.lastCoverageAt)}</span></td>
      <td><span>{title(feedback.activityState)}</span><span>{title(feedback.readinessState)}</span><span>Missing {feedback.missingMetricCount}</span></td>
      <td>{counts(feedback.diagnosticCounts, { revenue_decline: "Revenue decline" })}</td>
      <td>{counts(feedback.actionCardStatusCounts, { proposed: "Proposed", in_progress: "In progress", completed: "Completed", verified: "Verified", cancelled: "Cancelled" })}</td>
      <td>{counts(feedback.verificationOutcomeCounts, { effective: "Effective", ineffective: "Ineffective", not_executed: "Not executed", data_insufficient: "Data insufficient" })}</td>
    </tr>
  );
}

function counts(values: Record<string, number | undefined>, labels: Record<string, string>) {
  const entries = Object.entries(values);
  if (entries.length === 0) return <span>None</span>;
  return entries.map(([key, value]) => <span key={key}>{labels[key]} {value}</span>);
}

function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(new Date(value)) : "None";
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
