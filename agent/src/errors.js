'use strict';
// Perlu manusia (captcha, login habis, tampilan berubah). Agent berhenti dan menunggu.
class NeedsHuman extends Error { constructor(msg, reason = 'human') { super(msg); this.name = 'NeedsHuman'; this.reason = reason; } }
// Kegagalan generate. kind: policy | quota | timeout | unknown | fatal
class FlowError extends Error { constructor(msg, kind = 'unknown') { super(msg); this.name = 'FlowError'; this.kind = kind; } }
module.exports = { NeedsHuman, FlowError };
