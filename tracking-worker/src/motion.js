export const GPS_DEADBAND_M = 30;
export const GPS_MAX_ACCURACY_M = 40;

const EARTH_METERS_PER_DEGREE = 111_320;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function vectorMeters(anchor, point) {
  const latitudeA = Number(anchor.latitude);
  const latitudeB = Number(point.latitude);
  return {
    x:
      (Number(point.longitude) - Number(anchor.longitude)) *
      EARTH_METERS_PER_DEGREE *
      Math.cos(((latitudeA + latitudeB) * Math.PI) / 360),
    y: (latitudeB - latitudeA) * EARTH_METERS_PER_DEGREE,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function summarizeGpsMovement(rows, options = {}) {
  const deadbandM = options.deadbandM ?? GPS_DEADBAND_M;
  const maxAccuracyM = options.maxAccuracyM ?? GPS_MAX_ACCURACY_M;
  const maxGapS = options.maxGapS ?? 60;
  const ordered = [...rows]
    .filter((row) => {
      const latitude = numeric(row.latitude);
      const longitude = numeric(row.longitude);
      const accuracy = numeric(row.accuracy_m);
      return (
        latitude !== null &&
        longitude !== null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180 &&
        (accuracy === null || accuracy <= maxAccuracyM)
      );
    })
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));

  if (!ordered.length) {
    return {
      distanceM: 0,
      movingS: 0,
      stoppedS: 0,
      observedS: 0,
      avgMovingSpeedMps: null,
      maxSpeedMps: null,
      validPointsCount: 0,
    };
  }

  let anchor = ordered[0];
  let candidate = null;
  let pendingObservedS = 0;
  let observedS = 0;
  let movingS = 0;
  let distanceM = 0;
  const movingSpeeds = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const point = ordered[index];
    const previous = ordered[index - 1];
    const elapsedS =
      (Date.parse(point.captured_at) - Date.parse(previous.captured_at)) / 1000;
    if (elapsedS > 0 && elapsedS <= maxGapS) {
      observedS += elapsedS;
      pendingObservedS += elapsedS;
    }

    const displacement = vectorMeters(anchor, point);
    const displacementM = magnitude(displacement);
    const accuracy = Math.max(
      deadbandM,
      Math.min(maxAccuracyM, numeric(anchor.accuracy_m) ?? deadbandM),
      Math.min(maxAccuracyM, numeric(point.accuracy_m) ?? deadbandM),
    );
    if (displacementM < accuracy) {
      candidate = null;
      continue;
    }

    if (!candidate) {
      candidate = displacement;
      continue;
    }

    const sameDirection =
      candidate.x * displacement.x + candidate.y * displacement.y > 0;
    const movementSpanS = Math.max(
      0,
      (Date.parse(point.captured_at) - Date.parse(anchor.captured_at)) / 1000,
    );
    const plausibleM = Math.max(150, movementSpanS * 45);
    if (!sameDirection || displacementM > plausibleM) {
      candidate = sameDirection ? displacement : null;
      continue;
    }

    const estimatedSpeedMps =
      pendingObservedS > 0 ? displacementM / pendingObservedS : 0;
    for (let pendingIndex = index; pendingIndex >= 1; pendingIndex -= 1) {
      if (
        Date.parse(ordered[pendingIndex].captured_at) <=
        Date.parse(anchor.captured_at)
      )
        break;
      const rawSpeed = numeric(ordered[pendingIndex].speed_mps);
      movingSpeeds.push(rawSpeed !== null && rawSpeed >= 0.5 ? rawSpeed : estimatedSpeedMps);
    }
    distanceM += displacementM;
    movingS += pendingObservedS;
    pendingObservedS = 0;
    anchor = point;
    candidate = null;
  }

  return {
    distanceM,
    movingS,
    stoppedS: Math.max(0, observedS - movingS),
    observedS,
    avgMovingSpeedMps: movingSpeeds.length
      ? movingSpeeds.reduce((sum, speed) => sum + speed, 0) / movingSpeeds.length
      : null,
    maxSpeedMps: movingSpeeds.length ? Math.max(...movingSpeeds) : null,
    validPointsCount: ordered.length,
  };
}
