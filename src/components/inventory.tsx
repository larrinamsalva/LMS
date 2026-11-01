import { useState } from "react";
import type { WorkspaceRecord, WorkspaceSnapshot } from "../core/engine";
import { relatedLabel } from "./schedule";
export function Inventory({
  workspace,
  busy,
  onAdd,
  onEdit,
  onArchive,
}: {
  workspace: WorkspaceSnapshot;
  busy: boolean;
  onAdd: (entity: string, product?: WorkspaceRecord) => void;
  onEdit: (r: WorkspaceRecord) => void;
  onArchive: (r: WorkspaceRecord) => void;
}) {
  const [query, setQuery] = useState(""),
    [barcode, setBarcode] = useState(""),
    [message, setMessage] = useState(""),
    [archived, setArchived] = useState(false),
    [location, setLocation] = useState("");
  const records = workspace.records,
    manage = ["owner", "admin"].includes(workspace.role),
    write = manage || workspace.role === "staff";
  const products = records.filter(
    (r) =>
      r.entity === "items" &&
      r.archived === archived &&
      [r.data.name, r.data.sku, r.data.barcode, r.data.category].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const locations = records.filter((r) => r.entity === "stock-locations");
  const movementIds = new Set(
    workspace.stockMovements
      .filter(
        (m) =>
          !location ||
          m.location_id === location ||
          m.destination_id === location,
      )
      .map((m) => m.record_id),
  );
  const actions = (r: WorkspaceRecord) => (
    <div className="actions">
      {!r.archived && (
        <button
          className="secondary"
          disabled={!manage || busy}
          aria-label={`Edit ${r.data.name}`}
          onClick={() => onEdit(r)}
        >
          Edit
        </button>
      )}
      <button
        className="quiet"
        disabled={!manage || busy}
        aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.name}`}
        onClick={() => onArchive(r)}
      >
        {r.archived ? "Restore" : "Archive"}
      </button>
    </div>
  );
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="inventory-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              Fictional supplies · exact whole units
            </span>
            <h2 id="inventory-heading">Inventory & stock</h2>
          </div>
          <button disabled={!manage || busy} onClick={() => onAdd("items")}>
            + Add product
          </button>
        </div>
        <p className="muted">
          Receive, use, transfer or return supplies. Adjustments and corrections
          require owner/admin. Each post has a permanent actor, packaging
          snapshot and reason. Archived products retain their stock and history;
          restore them before moving stock.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={!write || busy}
            onClick={() => onAdd("stock-movements")}
          >
            + Record stock movement
          </button>
          <button
            className="secondary"
            disabled={!manage || busy}
            onClick={() => onAdd("stock-locations")}
          >
            + Add storage location
          </button>
        </div>
        <form
          className="stock-scanner"
          onSubmit={(e) => {
            e.preventDefault();
            const code = barcode.trim();
            if (!code) {
              setMessage("Enter a barcode or SKU.");
              return;
            }
            const found = records.filter(
              (r) =>
                r.entity === "items" &&
                !r.archived &&
                (String(r.data.barcode ?? "") === code ||
                  String(r.data.sku ?? "").toLowerCase() ===
                    code.toLowerCase()),
            );
            if (found.length !== 1) {
              setMessage(
                found.length
                  ? "Ambiguous code; select a product from the catalog."
                  : "No active product matches this code.",
              );
              return;
            }
            setMessage(
              `Selected ${found[0].data.name}. Review a movement before posting.`,
            );
            onAdd("stock-movements", found[0]);
          }}
        >
          <label htmlFor="stock-barcode">Scan or enter barcode / SKU</label>
          <input
            id="stock-barcode"
            value={barcode}
            maxLength={200}
            onChange={(e) => setBarcode(e.target.value)}
            autoComplete="off"
          />
          <button className="secondary" disabled={!write || busy} type="submit">
            Find product for movement
          </button>
          <p role="status">{message}</p>
        </form>
        <p className="muted">
          USB/Bluetooth keyboard scanners can type a code and press Enter.
          Scanning only selects a product; it never posts quantities. Camera
          scanning is planned.
        </p>
        <div className="record-toolbar">
          <div className="search-field">
            <label htmlFor="stock-search">Search inventory products</label>
            <input
              id="stock-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stock-location">Filter storage location</label>
            <select
              id="stock-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">All locations</option>
              {locations.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.data.name)}
                  {r.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            Show archived products
          </label>
        </div>
      </section>
      <section className="panel" aria-labelledby="stock-products-heading">
        <h2 id="stock-products-heading">Products & available stock</h2>
        <div className="workforce-grid">
          {products.map((p) => (
            <article
              className="workforce-card"
              aria-label={`Product ${p.data.name}`}
              key={p.id}
            >
              <h3>{String(p.data.name)}</h3>
              <p>
                {String(p.data.category || "Uncategorized")} ·{" "}
                {String(p.data.sku || "No SKU")} ·{" "}
                {String(p.data.case_size || "1")} units/case
              </p>
              {locations
                .filter((l) => !location || l.id === location)
                .map((l) => {
                  const units =
                    workspace.stockBalances.find(
                      (b) => b.product_id === p.id && b.location_id === l.id,
                    )?.units ?? "0";
                  const low =
                    BigInt(units) < BigInt(String(p.data.minimum || "0"));
                  return (
                    <p className={low ? "stock-low" : ""} key={l.id}>
                      <strong>
                        {String(l.data.name)}
                        {l.archived ? " (archived)" : ""}: {units}{" "}
                        {String(p.data.unit || "units")}
                      </strong>
                      {low && (
                        <span>
                          {" "}
                          · Low stock (minimum {String(p.data.minimum)})
                        </span>
                      )}
                    </p>
                  );
                })}
              {!locations.length && (
                <p>Add a storage location to receive stock.</p>
              )}
              {actions(p)}
              {!p.archived && (
                <button
                  className="secondary"
                  disabled={!write || busy}
                  onClick={() => onAdd("stock-movements", p)}
                >
                  Move {String(p.data.name)}
                </button>
              )}
            </article>
          ))}
        </div>
        {!products.length && <p>No matching products.</p>}
      </section>
      <section className="panel">
        <h2>Storage locations</h2>
        <div className="workforce-grid">
          {locations.map((l) => (
            <article className="workforce-card" key={l.id}>
              <h3>
                {String(l.data.name)}
                {l.archived ? " (archived)" : ""}
              </h3>
              <p>{String(l.data.notes || "")}</p>
              {actions(l)}
            </article>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="stock-history-heading">
        <h2 id="stock-history-heading">Stock movement history</h2>
        <p className="muted">
          Newest posts first. Movement date is operator supplied; recorded time
          is retained separately. Corrections add history.
        </p>
        <div className="workforce-grid">
          {workspace.stockMovements
            .filter((m) => movementIds.has(m.record_id))
            .map((m) => (
              <article
                className="workforce-card"
                aria-label={`Movement ${m.action} ${m.product_name}`}
                key={m.record_id}
              >
                <h3>
                  {m.action} · {m.product_name}
                </h3>
                <p>
                  {m.quantity} {m.packaging.toLowerCase()} ×{" "}
                  {m.packaging === "Cases" ? m.case_size : "1"} = {m.units}{" "}
                  {m.unit}
                </p>
                <p>
                  {m.location_name}
                  {m.destination_name ? ` → ${m.destination_name}` : ""} ·{" "}
                  {m.occurred_on}
                </p>
                <p>{m.reason}</p>
                <p className="muted">
                  {m.actor_name} · {m.actor_id}
                  <br />
                  Recorded {new Date(m.recorded_at).toISOString()}
                </p>
                {m.work_id && (
                  <p>
                    Work: {m.work_title || relatedLabel(m.work_id, records)}
                  </p>
                )}
                {m.correction_id && <p>Corrects movement {m.correction_id}</p>}
                <details>
                  <summary>Movement receipt</summary>
                  <p className="stock-identifiers">
                    {m.record_id}
                    <br />
                    {m.operation_id}
                  </p>
                </details>
              </article>
            ))}
        </div>
        {!movementIds.size && <p>No movements at this location.</p>}
      </section>
    </div>
  );
}
