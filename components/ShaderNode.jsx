"use client";

/**
 * Shader node renderer (M5) — the WebGL island inside the DOM renderer.
 *
 * A <canvas> fills the node box. Its bitmap resolution tracks the node's
 * on-screen size (layout size × settled viewport zoom × devicePixelRatio,
 * capped at 1024px on the long edge): cheap at fit-zoom, crisp when
 * zoomed in. The viewport zoom is debounced (~150ms) so a wheel-zoom
 * gesture doesn't thrash GL reallocations; size changes are caught by a
 * ResizeObserver on the canvas.
 *
 * The context is created with preserveDrawingBuffer: true — without it
 * the browser may clear the bitmap after compositing, and the PNG
 * export (html-to-image, Inspector) would capture a blank node.
 *
 * If WebGL is unavailable (or the program fails to build), the node
 * falls back to a CSS composite of the same four colours — layered
 * radial gradients at the anchors' corner positions — so a shader node
 * is never a blank hole in the document.
 */
import { useEffect, useRef, useState } from "react";
import { buildUniforms, FRAGMENT_SRC, VERTEX_SRC } from "@/lib/shader";
import { useEditorStore } from "@/lib/store";

/** Bitmap cap on the long edge, in device px. */
const MAX_EDGE = 1024;

/** CSS approximation of the gradient, shared shape with lib/codegen.js:
 *  the four colours as radial washes over a base of the first colour.
 *  Positions are the fragment shader's anchors flipped to CSS's
 *  top-left origin. */
export function shaderFallbackCss(colors) {
  const [c0, c1, c2, c3] = [0, 1, 2, 3].map(
    (i) => colors?.[i] ?? "#000000",
  );
  return [
    `radial-gradient(circle at 10% 88%, ${c0} 0%, transparent 70%)`,
    `radial-gradient(circle at 90% 82%, ${c1} 0%, transparent 70%)`,
    `radial-gradient(circle at 84% 12%, ${c2} 0%, transparent 70%)`,
    `radial-gradient(circle at 16% 18%, ${c3} 0%, transparent 70%)`,
    c0,
  ].join(", ");
}

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return program;
}

export default function ShaderNode({ node }) {
  const canvasRef = useRef(null);
  const glStateRef = useRef(null); // { gl, program, u: {locations} }
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const [renderZoom, setRenderZoom] = useState(zoom);
  const [sizeTick, setSizeTick] = useState(0);
  const [glFailed, setGlFailed] = useState(false);

  // Zoom changes arrive in bursts (wheel gestures); only the settled
  // zoom is worth a bitmap realloc + redraw.
  useEffect(() => {
    const t = setTimeout(() => setRenderZoom(zoom), 150);
    return () => clearTimeout(t);
  }, [zoom]);

  // The node's layout size can change without the node object changing
  // identity in ways React tracks (flex parents, fit sizing) — observe
  // the canvas itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setSizeTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [glFailed]);

  const shader = node.shader;

  useEffect(() => {
    if (glFailed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;

    let state = glStateRef.current;
    if (!state) {
      const gl =
        canvas.getContext("webgl", { preserveDrawingBuffer: true }) ??
        canvas.getContext("experimental-webgl", {
          preserveDrawingBuffer: true,
        });
      if (!gl) {
        setGlFailed(true);
        return;
      }
      const program = createProgram(gl);
      if (!program) {
        setGlFailed(true);
        return;
      }
      gl.useProgram(program);
      // One fullscreen triangle: (-1,-1) (3,-1) (-1,3) covers the
      // viewport with a single primitive, no diagonal seam.
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      const posLoc = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      state = {
        gl,
        program,
        u: {
          colors: gl.getUniformLocation(program, "u_colors[0]"),
          scale: gl.getUniformLocation(program, "u_scale"),
          rotation: gl.getUniformLocation(program, "u_rotation"),
          distortion: gl.getUniformLocation(program, "u_distortion"),
          softness: gl.getUniformLocation(program, "u_softness"),
          grain: gl.getUniformLocation(program, "u_grain"),
          resolution: gl.getUniformLocation(program, "u_resolution"),
        },
      };
      glStateRef.current = state;
    }

    const { gl, u } = state;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let tw = Math.max(1, Math.round(cw * renderZoom * dpr));
    let th = Math.max(1, Math.round(ch * renderZoom * dpr));
    const longEdge = Math.max(tw, th);
    if (longEdge > MAX_EDGE) {
      const k = MAX_EDGE / longEdge;
      tw = Math.max(1, Math.round(tw * k));
      th = Math.max(1, Math.round(th * k));
    }
    if (canvas.width !== tw) canvas.width = tw;
    if (canvas.height !== th) canvas.height = th;

    gl.viewport(0, 0, tw, th);
    gl.useProgram(state.program);
    const uni = buildUniforms(shader);
    gl.uniform3fv(u.colors, new Float32Array(uni.colors.flat()));
    gl.uniform1f(u.scale, uni.scale);
    gl.uniform1f(u.rotation, uni.rotationRad);
    gl.uniform1f(u.distortion, uni.distortion);
    gl.uniform1f(u.softness, uni.softness);
    gl.uniform1f(u.grain, uni.grain);
    gl.uniform2f(u.resolution, tw, th);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }, [shader, renderZoom, sizeTick, glFailed]);

  if (glFailed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: shaderFallbackCss(shader?.colors),
        }}
      />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
