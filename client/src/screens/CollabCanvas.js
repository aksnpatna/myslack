import { useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';

/**
 * CollabCanvas
 *
 * Props:
 *   channelId  {string}   – used to scope WS broadcasts
 *   userId     {string}   – sender identity
 *   wsSend     {function} – wsSend(payload) from parent
 *   wsRef      {ref}      – raw WebSocket ref so we can filter own echo frames
 *   color      {string}   – active brush colour (#hex)
 *   brushSize  {number}   – stroke width in px
 *   onClose    {function} – called when user hits ✕
 */
export default function CollabCanvas({
  channelId, userId, wsSend, wsRef,
  color = '#e8912d', brushSize = 4, onClose,
}) {
  const canvasRef   = useRef(null);
  const drawing     = useRef(false);
  const lastPos     = useRef({ x: 0, y: 0 });
  // Keep a stable ref to colour/brush so event handlers don't go stale
  const colorRef     = useRef(color);
  const brushRef     = useRef(brushSize);
  useEffect(() => { colorRef.current = color; },     [color]);
  useEffect(() => { brushRef.current = brushSize; }, [brushSize]);

  // ── Remote draw from WS ───────────────────────────────────────────────
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    function onMessage(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'canvas_draw' || msg.channelId !== channelId) return;
        if (!msg.isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        drawSegment(ctx, msg.prevX, msg.prevY, msg.x, msg.y, msg.color, msg.brushSize);
      } catch { /* ignore */ }
    }

    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [channelId, wsRef]);

  // ── Local drawing helpers ─────────────────────────────────────────────
  function drawSegment(ctx, x0, y0, x1, y1, col, size) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = col;
    ctx.lineWidth   = size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const startDraw = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const pos = getPos(e, canvas);
    lastPos.current = pos;
    // Emit a point-start frame
    wsSend({ type: 'canvas_draw', channelId, userId, ...pos, prevX: pos.x, prevY: pos.y, color: colorRef.current, brushSize: brushRef.current, isDrawing: true });
  }, [channelId, userId, wsSend]);

  const moveDraw = useCallback((e) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const pos  = getPos(e, canvas);
    const prev = lastPos.current;
    const ctx  = canvas.getContext('2d');
    drawSegment(ctx, prev.x, prev.y, pos.x, pos.y, colorRef.current, brushRef.current);
    wsSend({ type: 'canvas_draw', channelId, userId, x: pos.x, y: pos.y, prevX: prev.x, prevY: prev.y, color: colorRef.current, brushSize: brushRef.current, isDrawing: true });
    lastPos.current = pos;
  }, [channelId, userId, wsSend]);

  const endDraw = useCallback(() => {
    drawing.current = false;
    wsSend({ type: 'canvas_draw', channelId, userId, x: 0, y: 0, prevX: 0, prevY: 0, color: colorRef.current, brushSize: brushRef.current, isDrawing: false });
  }, [channelId, userId, wsSend]);

  // ── Attach DOM events (canvas is a real DOM element on web) ─────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('mousedown',  startDraw);
    canvas.addEventListener('mousemove',  moveDraw,  { passive: false });
    canvas.addEventListener('mouseup',    endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: true });
    canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
    canvas.addEventListener('touchend',   endDraw);
    return () => {
      canvas.removeEventListener('mousedown',  startDraw);
      canvas.removeEventListener('mousemove',  moveDraw);
      canvas.removeEventListener('mouseup',    endDraw);
      canvas.removeEventListener('mouseleave', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove',  moveDraw);
      canvas.removeEventListener('touchend',   endDraw);
    };
  }, [startDraw, moveDraw, endDraw]);

  // ── Clear board ───────────────────────────────────────────────────────
  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  return (
    <View style={cs.wrapper}>
      {/* Toolbar */}
      <View style={cs.toolbar}>
        <View style={[cs.colorDot, { backgroundColor: color }]} />
        <View style={cs.toolbarRight}>
          <View
            style={cs.clearBtn}
            onClick={clearCanvas}
            accessibilityRole="button"
          >
            <span style={{ color: '#9b9b9b', fontSize: 12, cursor: 'pointer' }}>🗑 Clear</span>
          </View>
          <View
            style={cs.closeBtn}
            onClick={onClose}
            accessibilityRole="button"
          >
            <span style={{ color: '#9b9b9b', fontSize: 14, cursor: 'pointer' }}>✕</span>
          </View>
        </View>
      </View>

      {/* Canvas — rendered via dangerouslySetInnerHTML trick-free; just a ref */}
      <canvas
        ref={canvasRef}
        width={900}
        height={520}
        style={{
          width: '100%',
          height: 520,
          backgroundColor: '#16181d',
          cursor: 'crosshair',
          borderRadius: 8,
          display: 'block',
        }}
      />
    </View>
  );
}

const cs = StyleSheet.create({
  wrapper:      { backgroundColor: '#1e1f23', borderRadius: 10, padding: 12, gap: 8 },
  toolbar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  toolbarRight: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  colorDot:     { width: 16, height: 16, borderRadius: 8 },
  clearBtn:     { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#2c2f33', borderRadius: 5 },
  closeBtn:     { paddingHorizontal: 8, paddingVertical: 4 },
});
