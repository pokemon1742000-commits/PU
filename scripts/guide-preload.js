const { contextBridge } = require('electron');

const rows = {
  review:[{
    projectCode:'MEC2205011', scanDrawingCode:'KEG12Y', status:'Chờ xác nhận',
    purchaseDecisionId:'purchase-demo', purchaseKind:'pending', purchaseCandidateCode:'KEG12V', purchaseScore:92,
    purchaseOptions:[{ code:'KEG12V', score:92 }, { code:'KEG12Y', score:88 }],
    warehouseDecisionId:'warehouse-demo', warehouseKind:'pending', warehouseCandidateCode:'KEG12Y', warehouseScore:100,
    warehouseOptions:[{ code:'KEG12Y', score:100 }]
  }],
  enough:[
    { projectCode:'MEC2205011', drawingCode:'KEG12Y', purchaseOrder:'PR-MEC-001', supplier:'NCC A', itemName:'Cover', scanQuantity:2, warehouseQuantity:2, purchaseQuantity:2, warehouseStatus:'Đủ', scanStatus:'Đủ', note:'', maker:'PMA', scanDate:'15/Aug', warehouseDate:'14/08/2026', matchStatus:'Khớp chính xác' },
    { projectCode:'AUTM260552', drawingCode:'2505080-TD-001', purchaseOrder:'PR-AUT-008', supplier:'COKHIVIET', itemName:'Tủ điện - P02', scanQuantity:1, warehouseQuantity:1, purchaseQuantity:1, warehouseStatus:'Đủ', scanStatus:'Đủ', note:'', maker:'MKAC', scanDate:'16/Aug', warehouseDate:'15/08/2026', matchStatus:'Khớp chính xác' }
  ]
};

contextBridge.exposeInMainWorld('api', {
  getState: async () => ({ counts:{ purchase:305364, scans:128, warehouse:8421, comparison:130, enough:96, shortage:21, excess:13, review:1, warnings:2 }, rawCounts:{ purchase:305364, scan:138, warehouse:8500, jobCodes:2156, warnings:305364 }, sources:[], autoThreshold:91, confirmationThreshold:90, purchaseReplacements:[], appVersion:'1.0.6' }),
  getRows: async name => { const data=rows[name] || []; return { rows:data, page:1, pageSize:100, total:data.length, totalPages:1 }; },
  onUpdateStatus: () => () => {}, openExternal:async()=>true, checkForUpdates:async()=>({ status:'current' }),
  pickFiles:async()=>({ canceled:true }), loadFiles:async()=>({ canceled:true }), runComparison:async()=>({}),
  resolveReview:async()=>({}), savePurchaseReplacement:async()=>({}), deletePurchaseReplacement:async()=>({}),
  clearSession:async()=>({}), deleteDatabase:async()=>({}), exportExcel:async()=>({ canceled:true })
});
