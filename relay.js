import { createMqttListenOver } from '@yakult-green-tea/qq-music-api/mqtt';
import WebSocket from 'ws';

export function createRelay() {
  const sessions = new Map();
  const listen = createMqttListenOver((url, protocol, handlers) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocol, { handshakeTimeout: 15000 });
    ws.on('message', handlers.message);
    ws.on('close', handlers.close);
    ws.on('error', error => { reject(error); handlers.error(error); });
    ws.once('open', () => resolve({ send: data => ws.send(data), close: () => { handlers.close(); ws.terminate(); } }));
  }));
  const close = async id => {
    const row = sessions.get(id);
    if (row) { clearTimeout(row.timer); row.listener.close(); sessions.delete(id); }
  };
  return {
    async open(id, image, ttl) {
      if (sessions.has(id)) return sessions.get(id).listener.ready;
      if (sessions.size >= 100) throw new Error('Too many active QR sessions');
      const events = [];
      const listener = listen(id, event => { if (events.length < 100) events.push(event); }, Math.min(ttl, 180000));
      const timer = setTimeout(() => void close(id), Math.min(ttl, 180000));
      timer.unref();
      sessions.set(id, { image, events, listener, timer });
      try { await listener.ready; } catch (error) { await close(id); throw error; }
    },
    async image(id) { return sessions.get(id)?.image || ''; },
    async poll(id) { return [...(sessions.get(id)?.events || [])]; },
    close,
    async dispose() { await Promise.all([...sessions.keys()].map(close)); },
  };
}
