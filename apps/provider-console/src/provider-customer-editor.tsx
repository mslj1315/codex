import { type FormEvent, useState } from "react";
import type { ProviderApiClient } from "./api";
import {
  replaceProviderCustomerMetadata,
  type ProviderCustomerItem,
  type ProviderCustomerMetadata
} from "./feedback";

export interface ProviderCustomerEditorProps {
  item: ProviderCustomerItem;
  api: ProviderApiClient;
  onSaved(metadata: ProviderCustomerMetadata | null): void;
  onAuthenticationRequired(): void;
  onReloadRequested(): void;
  onEditingForbidden(): void;
  onClosed?(): void;
}

type EditorState = "ready" | "saving" | "conflict" | "error" | "forbidden";

export function ProviderCustomerEditor({
  item,
  api,
  onSaved,
  onAuthenticationRequired,
  onReloadRequested,
  onEditingForbidden,
  onClosed
}: ProviderCustomerEditorProps) {
  const [customerAlias, setCustomerAlias] = useState(item.metadata?.customerAlias ?? "");
  const [providerNote, setProviderNote] = useState(item.metadata?.providerNote ?? "");
  const [state, setState] = useState<EditorState>("ready");

  async function save() {
    if (state === "saving" || state === "forbidden") return;
    setState("saving");
    try {
      const metadata = await replaceProviderCustomerMetadata(api, item.feedback, {
        customerAlias: emptyAsNull(customerAlias),
        providerNote: emptyAsNull(providerNote),
        expectedVersion: item.metadata?.version ?? null
      });
      onSaved(metadata);
    } catch (error) {
      const status = error instanceof Response ? error.status : 0;
      if (status === 401) {
        onAuthenticationRequired();
        return;
      }
      if (status === 403) {
        setState("forbidden");
        onEditingForbidden();
        onClosed?.();
        return;
      }
      setState(status === 409 ? "conflict" : "error");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  if (state === "forbidden") {
    return <section className="customer-editor-message" role="status">Customer editing is no longer available for this account.</section>;
  }

  return (
    <section className="customer-editor" aria-labelledby="customer-editor-title">
      <div className="customer-editor-heading">
        <div>
          <p className="eyebrow">Customer details</p>
          <h2 id="customer-editor-title">{item.metadata?.customerAlias ?? item.feedback.enterpriseId}</h2>
          <p className="customer-identifiers">{item.feedback.enterpriseId} / {item.feedback.storeId}</p>
        </div>
        {onClosed && <button className="secondary-button" disabled={state === "saving"} onClick={onClosed} type="button">Close</button>}
      </div>
      <form onSubmit={submit}>
        <label htmlFor="customer-alias">
          Customer alias
          <input aria-label="Customer alias" id="customer-alias" value={customerAlias} onChange={(event) => setCustomerAlias(limitCodePoints(event.target.value, 120))} />
          <span className="field-limit" aria-live="polite">{codePointCount(customerAlias)} / 120 characters</span>
        </label>
        <label htmlFor="provider-note">
          Provider note
          <textarea aria-label="Provider note" id="provider-note" rows={5} value={providerNote} onChange={(event) => setProviderNote(limitCodePoints(event.target.value, 2000))} />
          <span className="field-limit" aria-live="polite">{codePointCount(providerNote)} / 2000 characters</span>
        </label>
        {state === "conflict" && (
          <div className="editor-message" role="status">
            <p>This customer changed elsewhere. Review the latest values before saving again.</p>
            <button className="secondary-button" onClick={onReloadRequested} type="button">Reload</button>
          </div>
        )}
        {state === "error" && (
          <div className="editor-message" role="status">
            <p>Customer details could not be saved.</p>
            <button className="secondary-button" onClick={() => void save()} type="button">Retry</button>
          </div>
        )}
        <div className="customer-editor-actions">
          <button disabled={state === "saving"} type="submit">{state === "saving" ? "Saving" : "Save"}</button>
        </div>
      </form>
    </section>
  );
}

function emptyAsNull(value: string): string | null {
  return value === "" ? null : value;
}

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function limitCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}
