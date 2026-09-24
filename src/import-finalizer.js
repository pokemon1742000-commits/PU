const path = require('path');
const { Database } = require('./storage');
const {
  buildComparison,
  filterPurchasesByProjectPrefix,
  mergePurchaseRows,
  mergeWarehouseRows
} = require('./processor');

function emptyComparison() {
  return { comparison:[], review:[], enough:[], shortage:[], excess:[] };
}

async function readBounded(database, table, maxRows, largeDatasets) {
  const total = await database.countTableRows(table);
  if (total > maxRows) {
    largeDatasets.push(table);
    return { rows:[], total };
  }
  return { rows:await database.readTablePage(table, { limit:maxRows }), total };
}

async function finalizeImport({
  dataDir,
  kind,
  maxSessionRows = 50000,
  formatWarnings = [],
  decisions = [],
  comparisonThreshold = 91,
  confirmationThreshold = 90,
  purchaseReplacements = [],
  onProgress
}) {
  const database = new Database(dataDir);
  const largeDatasets = [];
  let initialized = false;
  try {
    await database.init();
    initialized = true;
    onProgress?.({ phase:'rebuilding', cancelable:false });
    const merged = await database.rebuildMergedFromRaw(kind, { includeRows:false });

    onProgress?.({ phase:'refreshing', cancelable:false });
    const purchaseBounded = await readBounded(database, 'purchases', maxSessionRows, largeDatasets);
    const scansBounded = await readBounded(database, 'scans', maxSessionRows, largeDatasets);
    const warehouseBounded = await readBounded(database, 'warehouse', maxSessionRows, largeDatasets);
    const workshopBounded = await readBounded(database, 'workshop', maxSessionRows, largeDatasets);
    const purchaseRawBounded = await readBounded(database, 'purchase_raw', maxSessionRows, largeDatasets);
    const { rows:purchaseAll, total:purchaseTotal } = purchaseBounded;
    const { rows:scans, total:scanTotal } = scansBounded;
    const { rows:warehouse, total:warehouseTotal } = warehouseBounded;
    const { rows:workshop, total:workshopTotal } = workshopBounded;
    const { rows:purchaseDetails, total:purchaseRawTotal } = purchaseRawBounded;

    const purchaseFiltered = filterPurchasesByProjectPrefix(purchaseAll);
    const purchase = mergePurchaseRows(purchaseFiltered.valid);
    const warningSource = purchaseDetails.length ? purchaseDetails : purchaseAll;
    const warnings = [
      ...formatWarnings,
      ...filterPurchasesByProjectPrefix(warningSource).warnings
    ].filter((row, index, rows) => {
      const key = JSON.stringify([row.source, row.sourceFile, row.sourceRow, row.note, row.original]);
      return rows.findIndex(candidate => JSON.stringify([candidate.source, candidate.sourceFile, candidate.sourceRow, candidate.note, candidate.original]) === key) === index;
    });

    onProgress?.({ phase:'comparing', cancelable:false });
    let derived = emptyComparison();
    if (!largeDatasets.length && scans.length && (purchase.length || warehouse.length || workshop.length)) {
      const comparisonWarehouse = mergeWarehouseRows([...warehouse, ...workshop]);
      derived = buildComparison(
        purchase,
        scans,
        comparisonWarehouse,
        comparisonThreshold,
        new Map(decisions || []),
        confirmationThreshold,
        purchaseReplacements
      );
    }

    const countTables = ['purchase_raw','scan_raw','warehouse_raw','workshop_raw','purchases','scans','warehouse','workshop'];
    const counts = {
      purchase_raw:purchaseRawTotal,
      purchases:purchaseTotal,
      scans:scanTotal,
      warehouse:warehouseTotal,
      workshop:workshopTotal
    };
    for (const table of countTables) if (counts[table] === undefined) counts[table] = await database.countTableRows(table);
    return {
      mergedStats:merged.stats,
      counts,
      sessionPatch:{ purchaseAll, purchase, scans, warehouse, workshop, warnings, ...derived, largeDatasets },
      largeDatasets
    };
  } finally {
    if (initialized) await database.close();
  }
}

module.exports = { finalizeImport };
