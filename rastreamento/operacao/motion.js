export const GPS_DEADBAND_M = 30;
export const GPS_MIN_PRECISION_M = 20;
export const GPS_MAX_PRECISION_M = 40;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function precisionRadius(point, fallbackM = GPS_DEADBAND_M) {
  const accuracy = numeric(point?.accuracy_m);
  if (accuracy === null || accuracy <= 0) return fallbackM;
  return Math.min(
    GPS_MAX_PRECISION_M,
    Math.max(GPS_MIN_PRECISION_M, fallbackM, accuracy),
  );
}

export function analyzeProjectedTrack(points, options = {}) {
  const deadbandM = options.deadbandM ?? GPS_DEADBAND_M;
  const maxAccuracyM = options.maxAccuracyM ?? GPS_MAX_PRECISION_M;
  const maxRailDistanceM = options.maxRailDistanceM ?? 500;
  const maxGapS = options.maxGapS ?? 60;
  const ordered = [...points]
    .filter((point) => {
      const accuracy = numeric(point.accuracy_m);
      const railDistance = numeric(point.projection?.distanceM);
      return (
        point.projection &&
        numeric(point.projection.stationM) !== null &&
        Array.isArray(point.projection.coordinate) &&
        railDistance !== null &&
        railDistance <= maxRailDistanceM &&
        (accuracy === null || accuracy <= maxAccuracyM)
      );
    })
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));

  if (!ordered.length) {
    return {
      accepted: [],
      timeline: [],
      distanceM: 0,
      movingS: 0,
      stoppedS: 0,
      observedS: 0,
      rejectedCount: points.length,
      suppressedCount: 0,
    };
  }

  const timeline = ordered.map((point) => ({
    ...point,
    effective_speed_mps: 0,
  }));
  const accepted = [timeline[0]];
  let anchor = timeline[0];
  let anchorIndex = 0;
  let candidate = null;
  let pendingObservedS = 0;
  let movingS = 0;
  let distanceM = 0;

  for (let index = 1; index < timeline.length; index += 1) {
    const point = timeline[index];
    const previous = timeline[index - 1];
    const elapsedS =
      (Date.parse(point.captured_at) - Date.parse(previous.captured_at)) / 1000;
    if (elapsedS > 0 && elapsedS <= maxGapS) pendingObservedS += elapsedS;

    const signedDelta = point.projection.stationM - anchor.projection.stationM;
    const thresholdM = Math.max(
      deadbandM,
      precisionRadius(anchor, deadbandM),
      precisionRadius(point, deadbandM),
    );
    if (Math.abs(signedDelta) < thresholdM) {
      candidate = null;
      continue;
    }

    if (!candidate) {
      candidate = { point, signedDelta };
      continue;
    }

    const sameDirection = Math.sign(candidate.signedDelta) === Math.sign(signedDelta);
    if (!sameDirection) {
      candidate = { point, signedDelta };
      continue;
    }

    const movementM = Math.abs(signedDelta);
    const movementSpanS = Math.max(
      0,
      (Date.parse(point.captured_at) - Date.parse(anchor.captured_at)) / 1000,
    );
    if (movementM > Math.max(150, movementSpanS * 45)) {
      candidate = null;
      continue;
    }
    const movementDurationS = pendingObservedS;
    const estimatedSpeedMps = movementDurationS > 0 ? movementM / movementDurationS : 0;
    for (let pendingIndex = anchorIndex + 1; pendingIndex <= index; pendingIndex += 1) {
      const rawSpeed = numeric(timeline[pendingIndex].speed_mps);
      timeline[pendingIndex].effective_speed_mps =
        rawSpeed !== null && rawSpeed >= 0.5 ? rawSpeed : estimatedSpeedMps;
    }
    point.movement_m = movementM;
    accepted.push(point);
    distanceM += movementM;
    movingS += movementDurationS;
    pendingObservedS = 0;
    anchor = point;
    anchorIndex = index;
    candidate = null;
  }

  const observedS = timeline.slice(1).reduce((sum, point, index) => {
    const elapsedS =
      (Date.parse(point.captured_at) - Date.parse(timeline[index].captured_at)) /
      1000;
    return sum + (elapsedS > 0 && elapsedS <= maxGapS ? elapsedS : 0);
  }, 0);

  return {
    accepted,
    timeline,
    distanceM,
    movingS,
    stoppedS: Math.max(0, observedS - movingS),
    observedS,
    rejectedCount: points.length - ordered.length,
    suppressedCount: Math.max(0, ordered.length - accepted.length),
  };
}
