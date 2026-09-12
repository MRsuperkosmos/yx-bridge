// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// WebSocket bridge: the browser extension connects here; we forward commands.
import { WebSocketServer } from "ws";

export class Bridge {
  constructor({ port = 17555, host = "127.0.0.1", log = () => {}, getToken = () => null, onSetToken = () => {} } = {}) {
    this.port = port;
    this.host = host;
    this.log = log;
    this.getToken = getToken; // dynamic — returns the required shared password/token or null (open)
    this.onSetToken = onSetToken; // called when the extension changes the password from the browser
    this.ext = null; // active extension socket
    this.hello = null;
    this.pending = new Map();
    this.seq = 0;
    this.waiters = [];
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port, host: this.host });
    this.wss.on("connection", (sock, req) => {
      if (this.ext && this.ext.readyState === this.ext.OPEN) {
        this.log("replacing previous extension connection");
        try { this.ext.close(); } catch {}
      }
      this.ext = sock;
      this.log(`extension connected from ${req.socket.remoteAddress}`);
      sock.on("message", (data) => this._onMessage(sock, data));
      sock.on("close", () => {
        if (this.ext === sock) {
          this.ext = null;
          this.hello = null;
          this.log("extension disconnected");
        }
        for (const [id, p] of this.pending) {
          if (p.sock === sock) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(new Error("extension disconnected"));
          }
        }
      });
      sock.on("error", (e) => this.log("socket error: " + e.message));
    });
    this.wss.on("error", (e) => this.log("server error: " + e.message));
    return this;
  }

  _onMessage(sock, data) {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === "hello") {
      const required = this.getToken && this.getToken();
      if (required && msg.token !== required) {
        this.log("rejected extension: wrong/missing password");
        try { sock.send(JSON.stringify({ type: "auth", ok: false, error: "wrong password" })); } catch {}
        try { sock.close(); } catch {}
        if (this.ext === sock) this.ext = null;
        return;
      }
      this.hello = msg;
      this.authed = true;
      this.log(`hello: v${msg.version} protocol ${msg.protocol}${required ? " (authenticated)" : ""}`);
      try { sock.send(JSON.stringify({ type: "auth", ok: true })); } catch {}
      const w = this.waiters.splice(0);
      for (const r of w) r();
      return;
    }
    if (msg.type === "ping") {
      try { sock.send(JSON.stringify({ type: "pong", t: msg.t })); } catch {}
      return;
    }
    if (msg.type === "set_token") {
      // The extension changed the connection password from the browser; sync the server side.
      try { this.onSetToken(msg.token || null); this.log("connection password " + (msg.token ? "changed" : "removed") + " from the extension"); } catch (e) { this.log("set_token failed: " + e.message); }
      try { sock.send(JSON.stringify({ type: "token_synced", ok: true, hasPassword: !!msg.token })); } catch {}
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "unknown error"));
    }
  }

  get connected() {
    return !!(this.ext && this.ext.readyState === this.ext.OPEN);
  }

  async waitConnected(timeoutMs = 10000) {
    if (this.connected) return true;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== resolve);
        reject(new Error(`browser extension is not connected (waited ${timeoutMs} ms). Is the browser running with the YX Bridge extension enabled?`));
      }, timeoutMs);
      this.waiters.push(() => { clearTimeout(t); resolve(); });
    });
    return true;
  }

  async call(cmd, args = {}, { timeoutMs = 30000, connectTimeoutMs = 10000 } = {}) {
    await this.waitConnected(connectTimeoutMs);
    const id = ++this.seq;
    const sock = this.ext;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs} ms for ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, sock });
      try {
        sock.send(JSON.stringify({ id, cmd, args }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  close() {
    try { this.wss && this.wss.close(); } catch {}
    try { this.ext && this.ext.close(); } catch {}
  }
}
