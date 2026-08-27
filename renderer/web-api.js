(function () {
  if (window.api) return;

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = `YÃªu cáº§u tháº¥t báº¡i (${response.status})`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response.json();
  }

  function json(method, body) {
    return { method, headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body ?? {}) };
  }

  function selectExcelFiles() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xlsm';
      input.multiple = true;
      input.hidden = true;
      document.body.appendChild(input);
      let settled = false;
      const finish = files => { if (settled) return; settled = true; window.removeEventListener('focus', onFocus); input.remove(); resolve(files); };
      const onFocus = () => setTimeout(() => finish([...input.files]), 400);
      input.addEventListener('change', () => finish([...input.files]));
      window.addEventListener('focus', onFocus, { once:true });
      input.click();
    });
  }

  window.api = {
    getState:() => request('/api/state'),
    openExternal:url => { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve(true); },
    checkForUpdates:() => request('/api/update'),
    onUpdateStatus:() => () => {},
    pickFiles:async kind => {
      const files = await selectExcelFiles();
      if (!files.length) return { canceled:true };
      const form = new FormData();
      form.append('kind', kind);
      files.forEach(file => form.append('files', file));
      return request('/api/files/inspect', { method:'POST', body:form });
    },
    loadFiles:(kind, selections) => request('/api/files/load', json('POST', { kind, selections })),
    runComparison:settings => request('/api/comparison', json('POST', settings)),
    getRows:(name, options = {}) => request(`/api/rows/${encodeURIComponent(name)}?${new URLSearchParams(options)}`),
    resolveReview:payload => request('/api/review/resolve', json('POST', payload)),
    savePurchaseReplacement:payload => request('/api/purchase-replacements', json('POST', payload)),
    deletePurchaseReplacement:payload => request('/api/purchase-replacements', json('DELETE', payload)),
    clearSession:() => request('/api/session/clear', json('POST')),
    deleteDatabase:keyword => request('/api/database/delete', json('POST', { keyword })),
    exportExcel:async () => {
      const response = await fetch('/api/export');
      if (!response.ok) { let body = {}; try { body = await response.json(); } catch {} throw new Error(body.error || 'KhÃ´ng thá»ƒ xuáº¥t Excel.'); }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encoded ? decodeURIComponent(encoded) : 'DoiChieu.xlsx';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return { canceled:false, path:fileName };
    }
  };
})();
