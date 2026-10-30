// A tiny link between Breathfield on a computer and the pacer pad on a phone,
// so the phone follows pace changes and coherence taps without rescanning.
// It goes through ntfy.sh, a free public publish/subscribe relay: messages are
// posted to a random topic and the phone listens to it. Only the breathing
// pattern, its start time and zone taps are sent; nothing about you.
// Add ?relay=<url> to the page address to use another ntfy server.

const DEFAULT = 'https://ntfy.sh';

export function relayBase() {
  try { return new URLSearchParams(location.search).get('relay') || DEFAULT; } catch (e) { return DEFAULT; }
}
export const isDefaultRelay = (base) => base === DEFAULT;

export function newTopic() {
  const a = new Uint8Array(9);
  (crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }));
  return `breathfield-${[...a].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14)}`;
}

/** Fire and forget; a failed send only means the phone keeps the last rhythm. */
export async function publish(base, topic, msg) {
  try {
    const r = await fetch(`${base}/${encodeURIComponent(topic)}`, { method: 'POST', body: JSON.stringify(msg) });
    return r.ok;
  } catch (e) { return false; }
}

/**
 * Listen to a topic. onMsg(msg, sentAtSeconds). onState('live' | 'retrying').
 * Picks up the last few minutes of messages too, so a phone that just opened
 * the link gets the latest pace.
 */
export function subscribe(base, topic, onMsg, onState = () => {}) {
  let es = null, closed = false;
  const open = () => {
    if (closed) return;
    es = new EventSource(`${base}/${encodeURIComponent(topic)}/sse?since=10m`);
    es.onopen = () => onState('live');
    es.onerror = () => onState('retrying');
    es.onmessage = (e) => {
      let d, m;
      try { d = JSON.parse(e.data); m = JSON.parse(d.message); } catch (err) { return; }
      if (d.event && d.event !== 'message') return;
      onMsg(m, d.time || Date.now() / 1000);
    };
  };
  open();
  return { close() { closed = true; if (es) es.close(); } };
}
