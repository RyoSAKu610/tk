export function advanceSceneClock(state, deltaMs, scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) throw new TypeError('At least one scene is required');
  if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('deltaMs must be a non-negative number');
  let sceneIndex = Number.isSafeInteger(state?.sceneIndex) ? state.sceneIndex : 0;
  let elapsedMs = Number.isFinite(state?.elapsedMs) ? state.elapsedMs : 0;
  sceneIndex = Math.max(0, Math.min(scenes.length - 1, sceneIndex));
  elapsedMs = Math.max(0, elapsedMs + deltaMs);
  let changed = false;

  while (sceneIndex < scenes.length) {
    const durationMs = Number(scenes[sceneIndex]?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError(`Scene ${sceneIndex} has an invalid duration`);
    if (elapsedMs < durationMs) {
      return Object.freeze({ sceneIndex, elapsedMs, changed, complete: false });
    }
    if (sceneIndex === scenes.length - 1) {
      return Object.freeze({ sceneIndex, elapsedMs: durationMs, changed, complete: true });
    }
    elapsedMs -= durationMs;
    sceneIndex += 1;
    changed = true;
  }

  return Object.freeze({ sceneIndex: scenes.length - 1, elapsedMs: 0, changed, complete: true });
}
