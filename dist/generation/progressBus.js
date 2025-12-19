"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishGenerationProgress = publishGenerationProgress;
exports.getGenerationProgressBuffer = getGenerationProgressBuffer;
exports.subscribeGenerationProgress = subscribeGenerationProgress;
const channelsBySessionId = new Map();
function getOrCreateChannel(sessionId) {
    const existing = channelsBySessionId.get(sessionId);
    if (existing)
        return existing;
    const next = { listeners: new Set(), buffer: [], terminal: false, cleanupTimer: null };
    channelsBySessionId.set(sessionId, next);
    return next;
}
function scheduleCleanup(sessionId, channel) {
    if (channel.cleanupTimer)
        return;
    channel.cleanupTimer = setTimeout(() => {
        channelsBySessionId.delete(sessionId);
    }, 5 * 60 * 1000);
}
function publishGenerationProgress(sessionId, event) {
    if (!sessionId)
        return;
    const channel = getOrCreateChannel(sessionId);
    channel.buffer.push(event);
    if (channel.buffer.length > 400) {
        channel.buffer.splice(0, channel.buffer.length - 400);
    }
    if (event.type === "generation_complete" || event.type === "generation_failed") {
        channel.terminal = true;
        scheduleCleanup(sessionId, channel);
    }
    if (channel.listeners.size === 0)
        return;
    for (const listener of channel.listeners) {
        try {
            listener(event);
        }
        catch {
            // ignore listener errors
        }
    }
}
function getGenerationProgressBuffer(sessionId) {
    const channel = channelsBySessionId.get(sessionId);
    return channel ? [...channel.buffer] : [];
}
function subscribeGenerationProgress(sessionId, listener) {
    const channel = getOrCreateChannel(sessionId);
    channel.listeners.add(listener);
    return () => {
        const c = channelsBySessionId.get(sessionId);
        if (!c)
            return;
        c.listeners.delete(listener);
        if (c.listeners.size === 0 && c.terminal) {
            scheduleCleanup(sessionId, c);
        }
    };
}
//# sourceMappingURL=progressBus.js.map