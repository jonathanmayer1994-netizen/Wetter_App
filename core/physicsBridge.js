/**
 * BEST WEATHER — Alpine Physics Worker Bridge (Task 3a)
 * Manages physics worker messaging with graceful fallback to synchronous execution
 */

class PhysicsBridge {
  constructor() {
    this.worker = null;
    this.reqId = 0;
    this.pending = new Map();
    this.init();
  }

  init() {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker('./physics.worker.js');
        this.worker.onmessage = (e) => {
          const { id, status, data, error } = e.data || {};
          const handler = this.pending.get(id);
          if (handler) {
            this.pending.delete(id);
            if (status === 'success') handler.resolve(data);
            else handler.reject(new Error(error || 'Worker error'));
          }
        };
        this.worker.onerror = (err) => {
          console.warn('[PhysicsBridge] Worker runtime issue:', err);
        };
      } catch (err) {
        console.warn('[PhysicsBridge] Physics worker unsupported, falling back to synchronous:', err);
      }
    }
  }

  execute(action, payload, timeoutMs = 2500) {
    if (!this.worker) return Promise.reject(new Error('Physics worker not initialized'));
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Physics worker action ${action} timed out`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      this.worker.postMessage({ id, action, payload });
    });
  }
}

export const physicsBridge = new PhysicsBridge();
