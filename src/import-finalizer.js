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
    return [];
  }
  return database.readTablePage(table, { limit:maxRows });
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
    const purchaseAll = await readBounded(database, 'purchases', maxSessionRows, largeDatasets);
    const scans = await readBounded(database, 'scans', maxSessionRows, largeDatasets);
    const warehouse = await readBounded(database, 'warehouse', maxSessionRows, largeDatasets);
    const workshop = await readBounded(database, 'workshop', maxSessionRows, largeDatasets);
    const purchaseRawTotal = await database.countTableRows('purchase_raw');
    const purchaseDetails = purchaseRawTotal > maxSessionRows
      ? []
      : await database.readTablePage('purchase_raw', { limit:maxSessionRows });
    if (purchaseRawTotal > maxSessionRows && !largeDatasets.includes('purchase_raw')) largeDatasets.push('purchase_raw');

    const purchaseFiltered = filterPurchasesByProjectPrefix(purchaseAll);
    const purchase = mergePurchaseRows(purchaseFiltered.valid);
    const warningSource = purchaseDetails.length ? purchaseDetails : purchaseAll;
    const warnings = [
      ...formatWarnings.filter(row => row.source === 'Mua Hàng'),
      ...filterPurchasesByProjectPrefix(warningSource).warnings
    ];

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
    const counts = {};
    for (const table of countTables) counts[table] = await database.countTableRows(table);
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
