import { useState } from "react";
import type { WorkspaceRecord, WorkspaceSnapshot } from "../core/engine";
import { relatedLabel } from "./schedule";
import { lowStockAlerts, filterLowStockAlerts, type LowStockSort } from "../core/inventory";
import { lowStockPlanningCsv } from "../core/inventory-low-stock-csv";
import { physicalCountRows, physicalCountSheetCsv, previewPhysicalCountVariance } from "../core/inventory-count-sheet-csv";
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
    [location, setLocation] = useState(""),
    [outOfStockOnly, setOutOfStockOnly] = useState(false),
    [lowStockSort, setLowStockSort] = useState<LowStockSort>("product"),
    [countSelection, setCountSelection] = useState(""),
    [countedUnits, setCountedUnits] = useState("");
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
  const lowStock = filterLowStockAlerts(
    lowStockAlerts(records, workspace.stockBalances), records,
    { query, locationId: location, outOfStockOnly, sort: lowStockSort },
  );
  const countRows = physicalCountRows(
    records, workspace.stockBalances, workspace.organizationId, location, query,
  );
  const countRow = countRows.find(
    (row) => row.productId + ":" + row.locationId === countSelection,
  );
  const countPreview = countRow
    ? previewPhysicalCountVariance(countRow.recordedUnits, countedUnits)
    : { status: "not-entered" as const };
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
  function downloadPhysicalCountSheet() {
    if (!countRows.length) return;
    const csv = physicalCountSheetCsv(
      records, workspace.stockBalances, workspace.organizationId, location, query,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-physical-stock-count-sheet-" +
      (location ? "selected-location" : "all-locations") + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadLowStockPlan() {
    if (!lowStock.length) return;
    const csv = lowStockPlanningCsv(
      records, workspace.stockBalances, workspace.organizationId, location,
      { query, outOfStockOnly, sort: lowStockSort },
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lms-low-stock-planning-" +
      (location ? "selected-location" : "all-locations") + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
          <button
            className="secondary"
            type="button"
            disabled={countRows.length === 0}
            onClick={downloadPhysicalCountSheet}
          >
            Download physical count sheet CSV
          </button>
        </div>
        <p className="muted">
          The manual count sheet lists all active products and storage locations,
          including zero balances. Product search and location selection narrow
          the sheet. Fill in counted quantities offline; downloading cannot
          change inventory or post an adjustment.
        </p>
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
              onChange={(e) => {
                setQuery(e.target.value);
                setCountSelection("");
                setCountedUnits("");
              }}
            />
          </div>
          <div>
            <label htmlFor="stock-location">Filter storage location</label>
            <select
              id="stock-location"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setCountSelection("");
                setCountedUnits("");
              }}
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
      <section className="panel" aria-labelledby="stock-count-preview-heading">
        <h2 id="stock-count-preview-heading">Physical count variance preview</h2>
        <p className="muted">
          Select an active product and location, then enter the whole units
          physically counted. This compares your count with the latest saved
          ledger balance; it does not record a count or change stock.
          Differences must be reviewed using the existing authorized stock
          adjustment process.
        </p>
        <div className="record-toolbar">
          <div>
            <label htmlFor="stock-count-pair">Product and location to compare</label>
            <select
              id="stock-count-pair"
              value={countRow ? countSelection : ""}
              onChange={(event) => {
                setCountSelection(event.target.value);
                setCountedUnits("");
              }}
            >
              <option value="">Choose a product and storage location</option>
              {countRows.map((item) => (
                <option
                  value={item.productId + ":" + item.locationId}
                  key={item.productId + ":" + item.locationId}
                >
                  {item.productName} — {item.locationName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="stock-count-units">Physically counted units</label>
            <input
              id="stock-count-units"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              value={countRow ? countedUnits : ""}
              disabled={!countRow}
              onChange={(event) => setCountedUnits(event.target.value)}
              aria-describedby="stock-count-guidance"
            />
          </div>
        </div>
        <p className="muted" id="stock-count-guidance">
          Enter 0 to confirm an empty location. Whole numbers only, up to
          999,999,999,999 units. This is a local preview, not a saved count.
        </p>
        <div role="status" aria-live="polite">
          {!countRow && <p>Choose a product and storage location to compare counts.</p>}
          {countRow && (
            <>
              <p>Recorded stock: <strong>{countRow.recordedUnits} {countRow.unit}</strong>
                {" "}at {countRow.locationName}.</p>
              {countPreview.status === "not-entered" && (
                <p>Enter a physical count to see the difference.</p>
              )}
              {countPreview.status === "invalid" && (
                <p>Enter a valid whole-unit count from 0 to 999,999,999,999.</p>
              )}
              {countPreview.status === "match" && (
                <p><strong>Counts match: difference 0 {countRow.unit}.</strong>
                  {" "}No adjustment indicated.</p>
              )}
              {(countPreview.status === "increase" ||
                countPreview.status === "decrease") && (
                <p>
                  <strong>Difference: {countPreview.difference} {countRow.unit}.</strong>
                  {" "}Review an Adjustment {countPreview.status} of{" "}
                  {countPreview.magnitude} {countRow.unit} using the existing
                  owner/admin approval and stock movement flow.
                </p>
              )}
            </>
          )}
        </div>
      </section>
      <section className="panel" aria-labelledby="stock-watchlist-heading">
        <div className="section-heading">
          <h2 id="stock-watchlist-heading">Low-stock watchlist</h2>
          <button
            type="button"
            className="secondary"
            disabled={lowStock.length === 0}
            onClick={downloadLowStockPlan}
          >
            Download low-stock planning CSV
          </button>
        </div>
        <p className="muted">
          Active products and storage locations below a configured minimum
          per location. Archived products and locations are excluded. Missing
          balances count as zero; minimum zero disables alerts.
          This is a review list, not an automatic purchase or stock movement.
          The optional CSV rounds shortfalls up to whole cases for planning only;
          it is not a purchase order. Catalog search and storage-location
          selection also apply here and to the downloaded report.
          Largest shortfall sorts by individual product units, which may
          represent different supplies; it does not determine purchase priority.
        </p>
        <div className="record-toolbar">
          <label className="check-label">
            <input
              type="checkbox"
              checked={outOfStockOnly}
              onChange={(event) => setOutOfStockOnly(event.target.checked)}
            />
            {" "}Show out-of-stock only
          </label>
          <div>
            <label htmlFor="stock-shortfall-sort">Order low-stock alerts</label>
            <select
              id="stock-shortfall-sort"
              value={lowStockSort}
              onChange={(event) =>
                setLowStockSort(event.target.value as LowStockSort)}
            >
              <option value="product">Product name</option>
              <option value="shortfall">Largest unit shortfall first</option>
            </select>
          </div>
        </div>
        <p role="status">
          {lowStock.length} product-location {lowStock.length === 1 ? "shortfall" : "shortfalls"}
          {location ? " at the selected storage location" : " across active storage locations"}.
        </p>
        <div className="workforce-grid">
          {lowStock.map((alert) => {
            const product = records.find((r) =>
              r.id === alert.productId && r.entity === "items" && !r.archived
            );
            return (
              <article
                className="workforce-card stock-low"
                key={alert.productId + ":" + alert.locationId}
                aria-label={"Low stock " + alert.productName + " at " + alert.locationName}
              >
                <h3>{alert.productName}</h3>
                <p><strong>{alert.locationName}</strong></p>
                <p>{alert.units} {alert.unit} on hand · minimum {alert.minimum}</p>
                <p><strong>Below minimum by {alert.shortfall} {alert.unit}</strong></p>
                <button
                  className="secondary"
                  type="button"
                  disabled={!write || busy || !product}
                  onClick={() => { if (product) onAdd("stock-movements", product); }}
                >
                  Review stock movement
                </button>
              </article>
            );
          })}
        </div>
        {lowStock.length === 0 && (
          <p>No active product locations match the current shortage filters.</p>
        )}
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
