# Concurrency Theatre 1.1: rendering and recovery

Reviewed on 2026-10-24. This change continues the integrated textbook branch
`integration/upstreams-and-theatre-2026`; it does not change the teaching
contracts of the six laboratories.

## Backend and visual language

The pinned dependency remains Three.js **0.186.1**. `WebGPURenderer` uses WebGPU
when available, with WebGL 2 as its fallback. `?renderer=webgl` selects the
WebGL 2 path explicitly. TSL supplies a shared, view-dependent rim accent for
the materials. These are real shaders; there is no new mandatory browser
extension, postprocessing dependency or continuously animated background.

The graph highlights edges from the current recorded schedule. That path is
derived from model events, not from camera animation. Ownership arrows point
from lock to holder in both WebGL and SVG; waiting arrows point from thread to
lock. The arrow directions therefore show the same directed cycle in a deadlock.

Projected DOM labels use their measured text bounds. Primary labels take
precedence and may move a short distance vertically; secondary labels are
hidden when they would overlap. A viewport margin keeps text inside the
stage. Hidden labels are measured again after camera changes. The accessible
inspector retains the complete data independently of these visual decisions.

Camera presets, quality controls, object inspection and the expanded laboratory
layout do not change model state or advance time. Reduced-motion changes are
observed at runtime. Rendering uses request-on-change scheduling and stops when
the view is hidden or a computation is being measured.

Animation progress is clamped to the closed interval [0, 1]. A browser's frame
timestamp can precede a trajectory created later in the same frame; this must
not send a negative curve parameter into Three.js or disable the scene.

## Resource and quality bounds

Shared geometry and materials have a bounded inactive cache, while resources
referenced by the visible scene remain protected. Rendering the same immutable
snapshot keeps its meshes intact. Instanced GPU cells share geometry and
material, so a 4096-invocation display does not require 4096 draw calls.

Large imported memory layouts display an explicitly labelled 32-cell window
containing the latest access. The model remains complete, and every address can
still be inspected through the accessible selector. Distances and platforms
are schematic; the layout does not claim to image a physical processor cache.

All quality modes cap pixel ratio; Auto also caps framebuffer area. Auto reacts to
sustained frame intervals during animation, with hysteresis; idle intervals
are excluded. This is a presentation heuristic, not a GPU benchmark. No FPS or
GPU duration is inferred from CPU wall-clock time. Diagnostics describe the
last drawn frame and disclose the active backend and pixel ratio.

## Context and device loss

`renderer.onDeviceLost` marks the renderer unavailable and notifies the app.
The app immediately exposes the existing SVG/DOM controls. The controller,
cursor and saved branches remain live, so users can continue the lesson.

WebGL restoration reconstructs the backend. Three r186 disposes a WebGL
backend by losing its context, so recreation uses a replacement canvas with
the same attributes and reinstalls the renderer's listeners. This also avoids
trying to bind two different context types to one canvas. A new renderer reads
the most recent model snapshot after recovery. WebGPU device loss uses the
same lifecycle and retry path; unavailable adapters leave the accessible view
in place. One automatic WebGPU recovery is allowed; a second immediate loss
waits for explicit user retry instead of repeatedly creating devices.

An initialization generation guard prevents a disposed renderer from being
resurrected by a late promise. Final disposal removes pointer/media listeners,
controls, the resize observer, animation requests and GPU resources. The
compute layer also destroys a device that arrives after acquisition timeout
or cancellation.

## Inspection and provenance

Memory cards identify the exact model address, cache-line byte range, current
write owner and neighbouring fields. GPU cards show only fields actually read
from the result: global/local/workgroup IDs and optional subgroup values.
Missing subgroup data is shown as unavailable rather than guessed.

The keyboard inspector provides the same semantic information without picking
or even a GPU. Imported mappings remain labelled `ИМПОРТ`. Before dispatch,
an illustrative cell is labelled `СХЕМА`; it is not a measured invocation.
Inspection is read-only and refreshes from the current snapshot after a step.

## Other completed corrections

- Changing memory access mode after rewind explicitly forks the future. Normal
  replay still follows recorded events until the user makes an intervention.
- Returning to the memory scene honours its selected read-only mode.
- Benchmark import rejects missing or unrelated experiment identifiers.
- Imported native false-sharing reports retain their packed/padded protocol,
  per-thread units and external provenance.
- Failed GPU dispatch documents preserve a valid, empty export/import shape.

## Verification boundaries

The Node suite includes pure semantics, actual C++/OpenMP compilation, imported
textbook preservation, inspection, resource bounds and renderer lifecycle
tests. Lifecycle stubs test ordering and cleanup; they are not evidence of
driver recovery. Browser tests separately exercise the real
`WEBGL_lose_context` extension, shader compilation, restored state, reduced
motion, quality/camera controls, mobile layout and keyboard inspection.

GitHub Actions preserves browser traces and screenshots in
`theatre-browser-evidence` and the runnable static build in
`concurrency-theatre`. A software adapter verifies API and shader behaviour;
its timings are not physical GPU performance results. Actual WebGPU dispatch
is explicitly skipped if no adapter is available; it is not replaced by fake
measurements. The imported 4096-invocation and native protocol browser fixtures
are labelled synthetic test inputs.

## Primary references

- [Three.js r186 release](https://github.com/mrdoob/three.js/releases/tag/r186)
- [WebGPURenderer and WebGL 2 fallback](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Renderer lifecycle API](https://threejs.org/docs/pages/Renderer.html)
- [TSL specification](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- [Context restoration](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event)
- [Context-loss test extension](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context)

Optional WebGL extensions and experimental WGSL capabilities remain
feature-detected. Diagnostic availability is not a claim that the current
computation uses an extension to accelerate its kernel.
