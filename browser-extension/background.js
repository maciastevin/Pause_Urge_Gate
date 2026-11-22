/* Pause — background worker. Watches top-level navigations and sends
 * watch-list sites to the gate page instead. */
importScripts("gate/core.js");

const GATE = chrome.runtime.getURL("gate/index.html");

async function getState() {
  const r = await chrome.storage.local.get("state");
  return PauseCore.normalize(r.state);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const r = await chrome.storage.local.get("state");
  if (!r.state) await chrome.storage.local.set({ state: PauseCore.defaults() });
  if (details.reason === "install") chrome.tabs.create({ url: GATE });
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: GATE }));

async function check(details) {
  if (details.frameId !== 0) return;
  const url = details.url || "";
  if (!/^https?:/i.test(url)) return;
  const state = await getState();
  const hit = PauseCore.match(url, state.watch);
  if (!hit) return;
  const pausing = state.activePause && state.activePause.endsAt > Date.now();
  if (!pausing && PauseCore.hasPass(state, hit)) return;
  const gate = GATE + "?mode=pause&target=" + encodeURIComponent(url) + "&hit=" + encodeURIComponent(hit);
  try {
    await chrome.tabs.update(details.tabId, { url: gate });
  } catch (e) {
    /* tab went away */
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(check);
chrome.webNavigation.onCommitted.addListener(check);
chrome.webNavigation.onHistoryStateUpdated.addListener(check);
