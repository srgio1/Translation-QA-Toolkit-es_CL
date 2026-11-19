// Toolbar button opens the toolkit in a tab (a popup would close and stop a long fetch run).
const api = globalThis.browser ?? globalThis.chrome;
api.browserAction.onClicked.addListener(async () => {
  const url = api.runtime.getURL("app.html");
  const tabs = await api.tabs.query({ url });
  if (tabs.length) { await api.tabs.update(tabs[0].id, { active: true }); await api.windows.update(tabs[0].windowId, { focused: true }); }
  else await api.tabs.create({ url });
});
