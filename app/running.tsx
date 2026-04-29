import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  AppStateStatus,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  InteractionManager,
} from "react-native";
import { EventEmitter, requireNativeModule } from "expo-modules-core";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as IntentLauncher from "expo-intent-launcher";
import { Ionicons } from "@expo/vector-icons";
import type {
  RoutePoint,
  RunData,
  RunSplit,
  RunnerTrait,
  RunnerType,
} from "../utils/storage";
import {
  getRunnerTraitFromHistory,
  getRunnerTypeFromHistory,
  loadProfile,
  saveLastRun,
  saveRunHistory,
} from "../utils/storage";
import { loadInterstitial, showInterstitial } from "../utils/adManager";

const BATTERY_OPT_DISABLED_KEY = "@airunning/battery_optimization_disabled";
const RUN_VOICE_SETTINGS_KEY = "@airunning/runVoiceSettings";

let RunholicForeground: any = null;
let runholicEmitter: EventEmitter | null = null;

try {
  RunholicForeground = requireNativeModule("RunholicForeground");
  runholicEmitter = new EventEmitter(RunholicForeground);
} catch (e) {
  console.log("RunholicForeground not ready yet");
}

type AlertBtn = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
};

type RunVoiceSettings = {
  reportVoiceEnabled: boolean;
  coachVoiceEnabled: boolean;
};

type NativeAnnouncement = {
  key?: string | null;
  reportText?: string | null;
  coachText?: string | null;
};

type NativeSessionPayload = {
  sessionId: string | null;
  isRunning: boolean;
  isPaused: boolean;
  startedAt: number;
  endedAt: number;
  resumedAt?: number;

  elapsedMs: number;
  durationSec: number;
  distanceMeters: number;

  avgPaceSec: number;
  currentPaceSec: number;
  paceState: string;
  avgPaceLevel?: string;

  elevationGainMeters: number;
  elevationLossMeters: number;
  cadence: number;
  calories: number;

  targetDistanceKm: number;
  remainingDistanceKm: number;

  aiCoachAnalysis: string;
  runnerType: string;
  runnerTrait: string;

  routeSegments: RoutePoint[][];
  splits: Array<{
    km: number;
    avgPaceSec: number;
    cumulativeElevationGainM?: number;
    elevationDeltaM?: number;
    elevationGainM?: number;
    elevationLossM?: number;
  }>;
  lastPoint?: RoutePoint | null;

  autoPausedByGpsLoss: boolean;
  gpsLossNoticePending: boolean;

  pendingAnnouncements: NativeAnnouncement[];

  notificationVisible: boolean;
};

const DEFAULT_VOICE_SETTINGS: RunVoiceSettings = {
  reportVoiceEnabled: true,
  coachVoiceEnabled: true,
};

const IDLE_MAP_DELTA = 0.01;      
const EARLY_RUN_MAP_DELTA = 0.0015;
const FOLLOW_MAP_DELTA = 0.0035; 

function getNativeEmitter() {
  if (!RunholicForeground) return null;
  return runholicEmitter;
}

async function loadRunVoiceSettings(): Promise<RunVoiceSettings> {
  try {
    const raw = await AsyncStorage.getItem(RUN_VOICE_SETTINGS_KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;

    const parsed = JSON.parse(raw);
    return {
      reportVoiceEnabled:
        typeof parsed?.reportVoiceEnabled === "boolean"
          ? parsed.reportVoiceEnabled
          : true,
      coachVoiceEnabled:
        typeof parsed?.coachVoiceEnabled === "boolean"
          ? parsed.coachVoiceEnabled
          : true,
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

async function saveRunVoiceSettings(settings: RunVoiceSettings) {
  await AsyncStorage.setItem(RUN_VOICE_SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeRoutePoint(input: any): RoutePoint {
  return {
    latitude: Number(input?.latitude ?? 0),
    longitude: Number(input?.longitude ?? 0),
    altitude:
      input?.altitude == null || !Number.isFinite(Number(input.altitude))
        ? null
        : Number(input.altitude),
    timestamp:
      input?.timestamp == null || !Number.isFinite(Number(input.timestamp))
        ? undefined
        : Number(input.timestamp),
    accuracy:
      input?.accuracy == null || !Number.isFinite(Number(input.accuracy))
        ? null
        : Number(input.accuracy),
  };
}

function normalizeNativeSession(raw: any): NativeSessionPayload | null {
  if (!raw) return null;

  const routeSegments: RoutePoint[][] = Array.isArray(raw.routeSegments)
    ? raw.routeSegments.map((segment: any) =>
        Array.isArray(segment) ? segment.map(normalizeRoutePoint) : []
      )
    : [];

  const splits: RunSplit[] = Array.isArray(raw.splits)
    ? raw.splits.map((split: any) => ({
        km: Number(split?.km ?? 0),
        avgPaceSec: Number(split?.avgPaceSec ?? 0),
        cumulativeElevationGainM: Number(split?.cumulativeElevationGainM ?? 0),
        elevationDeltaM: Number(split?.elevationDeltaM ?? 0),
        elevationGainM: Number(split?.elevationGainM ?? 0),
        elevationLossM: Number(split?.elevationLossM ?? 0),
      }))
    : [];

  const pendingAnnouncements: NativeAnnouncement[] = Array.isArray(
    raw.pendingAnnouncements
  )
    ? raw.pendingAnnouncements.map((item: any) => ({
        key: item?.key ?? null,
        reportText: item?.reportText ?? null,
        coachText: item?.coachText ?? null,
      }))
    : [];

  const lastPoint =
    raw.lastPoint && typeof raw.lastPoint === "object"
      ? normalizeRoutePoint(raw.lastPoint)
      : null;

  return {
    sessionId: raw.sessionId ?? null,
    isRunning: !!raw.isRunning,
    isPaused: !!raw.isPaused,
    startedAt: Number(raw.startedAt ?? 0),
    endedAt: Number(raw.endedAt ?? 0),
    resumedAt: Number(raw.resumedAt ?? 0),

    elapsedMs: Number(raw.elapsedMs ?? 0),
    durationSec: Number(raw.durationSec ?? 0),
    distanceMeters: Number(raw.distanceMeters ?? 0),

    avgPaceSec: Number(raw.avgPaceSec ?? 0),
    currentPaceSec: Number(raw.currentPaceSec ?? 0),
    paceState: String(raw.paceState ?? "안정"),
    avgPaceLevel: String(raw.avgPaceLevel ?? "보통"),

    elevationGainMeters: Number(raw.elevationGainMeters ?? 0),
    elevationLossMeters: Number(raw.elevationLossMeters ?? 0),
    cadence: Number(raw.cadence ?? 0),
    calories: Number(raw.calories ?? 0),

    targetDistanceKm: Number(raw.targetDistanceKm ?? -1),
    remainingDistanceKm: Number(raw.remainingDistanceKm ?? -1),

    aiCoachAnalysis: String(
      raw.aiCoachAnalysis ?? "러닝을 시작하면 AI 코치 분석이 표시됩니다."
    ),
    runnerType: String(raw.runnerType ?? "중립"),
    runnerTrait: String(raw.runnerTrait ?? "미분류"),

    routeSegments,
    splits,
    lastPoint,

    autoPausedByGpsLoss: !!raw.autoPausedByGpsLoss,
    gpsLossNoticePending: !!raw.gpsLossNoticePending,

    pendingAnnouncements,

    notificationVisible: !!raw.notificationVisible,
  };
}

function flattenRoute(routeSegments: RoutePoint[][]): RoutePoint[] {
  return routeSegments.flat();
}

function distanceMetersBetween(a: RoutePoint, b: RoutePoint) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;

  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);

  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function buildDisplaySegments(routeSegments: RoutePoint[][]): RoutePoint[][] {
  const MAX_ACCURACY_METERS = 60;
  const MAX_SINGLE_JUMP_METERS = 45;
  const RECOVERY_NEAR_METERS = 18;

  return routeSegments
    .map((segment) => {
      if (!Array.isArray(segment) || segment.length === 0) return [];

      const cleaned: RoutePoint[] = [];
      let lastAccepted: RoutePoint | null = null;
      let pendingRejected: RoutePoint | null = null;

      for (const point of segment) {
        if (!point) continue;

        const accuracy = point.accuracy ?? null;

        // 정확도 너무 나쁜 점은 화면에서만 제외
        if (accuracy != null && accuracy > MAX_ACCURACY_METERS) {
          continue;
        }

        if (!lastAccepted) {
          cleaned.push(point);
          lastAccepted = point;
          pendingRejected = null;
          continue;
        }

        const jumpFromLast = distanceMetersBetween(lastAccepted, point);

        // 정상 범위면 그대로 채택
        if (jumpFromLast <= MAX_SINGLE_JUMP_METERS) {
          cleaned.push(point);
          lastAccepted = point;
          pendingRejected = null;
          continue;
        }

        // 첫 번째 이상점은 일단 보류
        if (!pendingRejected) {
          pendingRejected = point;
          continue;
        }

        // 보류점 근처로 다음 점이 이어지면 복구
        const jumpFromPending = distanceMetersBetween(pendingRejected, point);

        if (jumpFromPending <= RECOVERY_NEAR_METERS) {
          cleaned.push(point);
          lastAccepted = point;
          pendingRejected = null;
          continue;
        }

        // 계속 이상하면 최신 점으로 보류 갱신
        pendingRejected = point;
      }

      return cleaned;
    })
    .filter((segment) => segment.length >= 2);
}

function formatDateTimeText(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}

function buildRunDataFromNative(session: NativeSessionPayload): RunData {
  const startedAtMs = session.startedAt || Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  const endedAtMs = session.endedAt;
  const endedAtIso = new Date(endedAtMs).toISOString();

  const flatRoute = flattenRoute(session.routeSegments);
  const fallbackLastPoint = session.lastPoint ? [session.lastPoint] : [];

  const route =
    flatRoute.length > 0
      ? flatRoute
      : fallbackLastPoint;

  const routeSegments =
    session.routeSegments.length > 0 && flatRoute.length > 0
      ? session.routeSegments
      : fallbackLastPoint.length > 0
      ? [fallbackLastPoint]
      : [];

  return {
    id: session.sessionId ?? String(startedAtMs),
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    dateTimeText: formatDateTimeText(new Date(startedAtMs)),
    distance: session.distanceMeters / 1000,
    pace: session.avgPaceSec,
    duration: Math.max(Math.floor(session.durationSec), 0),
    calories: session.calories,
    cadence: Math.round(session.cadence),
    elevationGain: Math.round(session.elevationGainMeters),
    elevationLoss: Math.round(session.elevationLossMeters),
    aiCoachAnalysis: session.aiCoachAnalysis,
    runnerType: (session.runnerType || "중립") as RunnerType,
    runnerTrait: (session.runnerTrait || "미분류") as RunnerTrait,
    route,
    routeSegments,
    splits: session.splits,
  };
}

type FinalPaceStyle = "지속형" | "변속형";
type FinalFormStyle = "중립" | "케이던스형" | "스트라이드형";
type FinalSplitTrend = "상승" | "유지" | "하락";

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function formatDurationForSpeech(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);

  const parts = [];
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0) parts.push(`${m}분`);
  if (s > 0 || (h === 0 && m === 0)) parts.push(`${s}초`); // 0초만 있는 경우 대비

  return parts.join(' ');
}

function deriveFinalReportAxis(
  runnerType: RunnerType
): { paceStyle: FinalPaceStyle; formStyle: FinalFormStyle } {
  if (runnerType === "변속형") {
    return { paceStyle: "변속형", formStyle: "중립" };
  }

  if (runnerType === "케이던스형") {
    return { paceStyle: "지속형", formStyle: "케이던스형" };
  }

  if (runnerType === "스트라이드형") {
    return { paceStyle: "지속형", formStyle: "스트라이드형" };
  }

  return { paceStyle: "지속형", formStyle: "중립" };
}

function getEndSplitComment(splits: RunSplit[]) {
  if (splits.length < 2) {
    return pickRandom([
      "러닝 구간이 짧아 전체 흐름 변화는 크지 않았습니다.",
      "짧은 거리에서 비교적 일정한 리듬이 유지되었습니다.",
      "구간 분할이 적어 흐름 변화는 크게 나타나지 않았습니다.",
    ]);
  }

  const target = splits.slice(-2);
  const diff = target[1].avgPaceSec - target[0].avgPaceSec;

  if (diff >= 35) {
    return pickRandom([
      "후반 구간에서 페이스 하락 폭이 비교적 크게 나타났습니다.",
      "끝 구간에서는 속도 유지가 눈에 띄게 어려워졌습니다.",
      "마무리로 갈수록 리듬이 무거워지는 흐름이 뚜렷했습니다.",
    ]);
  }

  if (diff >= 20) {
    return pickRandom([
      "후반 구간에서 페이스 하락 경향이 나타났습니다.",
      "마무리 구간으로 갈수록 속도 유지가 다소 어려워졌습니다.",
      "끝 구간에서는 리듬이 조금 무거워지는 흐름이 보였습니다.",
    ]);
  }

  if (diff <= -35) {
    return pickRandom([
      "후반 구간에서 페이스를 크게 끌어올렸습니다.",
      "마무리 구간에서 흐름을 강하게 살려낸 점이 돋보였습니다.",
      "끝 구간에서 속도 회복이 뚜렷하게 나타났습니다.",
    ]);
  }

  if (diff <= -20) {
    return pickRandom([
      "후반 구간에서 페이스를 잘 끌어올렸습니다.",
      "마무리 구간으로 갈수록 흐름이 더 좋아졌습니다.",
      "끝 구간에서 리듬을 다시 살려낸 점이 좋았습니다.",
    ]);
  }

  return pickRandom([
    "후반 구간에서도 흐름이 크게 흔들리지 않았습니다.",
    "마무리 구간까지 비교적 정돈된 리듬이 이어졌습니다.",
    "끝 구간에서도 페이스 흐름이 자연스럽게 유지되었습니다.",
  ]);
}

function deriveSplitTrend(splits: RunSplit[]): FinalSplitTrend {
  if (splits.length < 2) return "유지";

  const target = splits.slice(-2);
  const diff = target[1].avgPaceSec - target[0].avgPaceSec;

  if (diff >= 20) return "하락";
  if (diff <= -20) return "상승";
  return "유지";
}

function getCourseProfileComment(
  elevationGain: number,
  elevationLoss: number
) {
  const gain = Math.round(elevationGain);
  const loss = Math.round(elevationLoss);
  const diff = Math.abs(gain - loss);

  if (gain < 5 && loss < 5) {
    return pickRandom([
      "고도 변화가 크지 않은 코스였습니다.",
      "전반적으로 평지에 가까운 코스였습니다.",
      "오르내림이 크지 않은 비교적 편안한 코스였습니다.",
    ]);
  }

  if (diff < 5) {
    return pickRandom([
      "상승과 하강이 반복되는 롤링 코스 성격이 있었습니다.",
      "오르내림이 반복되는 흐름의 코스였습니다.",
      "상승과 하강이 비교적 고르게 나타난 코스였습니다.",
    ]);
  }

  if (gain > loss) {
    return pickRandom([
      "오르막 비중이 조금 더 있는 코스였습니다.",
      "상승 구간 부담이 상대적으로 더 큰 코스였습니다.",
      "하강보다 상승 쪽이 조금 더 강조된 코스였습니다.",
    ]);
  }

  return pickRandom([
    "내리막 비중이 조금 더 있는 코스였습니다.",
    "하강 구간 흐름이 상대적으로 더 드러난 코스였습니다.",
    "상승보다 하강 쪽이 조금 더 많은 코스였습니다.",
  ]);
}

function getFinalReportClosing({
  runnerType,
  paceStyle,
  formStyle,
  splitTrend,
  splits,
}: {
  runnerType: RunnerType;
  paceStyle: FinalPaceStyle;
  formStyle: FinalFormStyle;
  splitTrend: FinalSplitTrend;
  splits: RunSplit[];
}) {
  const endTrend = getEndSplitComment(splits);

  if (paceStyle === "변속형") {
    if (splitTrend === "상승") {
      return `${endTrend} ${pickRandom([
        "가속과 회복이 반복되는 패턴 속에서도 후반 흐름을 잘 살려낸 점이 좋았습니다.",
        "변속 흐름 속에서도 마지막으로 갈수록 리듬을 더 잘 끌어올린 점이 인상적이었습니다.",
        "구간 전환이 있는 러닝이었지만, 후반에는 흐름을 더 잘 정리해냈습니다.",
      ])}`;
    }
    if (splitTrend === "유지") {
      return `${endTrend} ${pickRandom([
        "구간 전환과 회복 흐름이 비교적 자연스러웠고, 전체 변속 패턴도 무난한 편이었습니다.",
        "가속과 회복의 연결이 비교적 부드러웠고, 전체적인 변속 흐름도 잘 유지되었습니다.",
        "전환 리듬이 크게 무너지지 않았고, 전체 운영도 비교적 안정적인 편이었습니다.",
      ])}`;
    }
    return `${endTrend} ${pickRandom([
      "회복 흐름이 길어지는 경향이 보여, 다음 러닝에서는 전환 이후 리듬 복귀를 조금 더 빠르게 가져가 보세요.",
      "회복 구간이 다소 길어지는 흐름이 있어, 다음에는 다시 힘을 싣는 타이밍을 조금 더 빠르게 잡아 보세요.",
      "리듬이 느슨해지는 구간이 보여, 다음 러닝에서는 전환 뒤 흐름 복귀를 조금 더 빠르게 시도해 보세요.",
    ])}`;
  }

  if (formStyle === "케이던스형") {
    if (splitTrend === "상승") {
      return `${endTrend} ${pickRandom([
        "케이던스 중심 리듬을 유지하면서 후반 흐름을 더 끌어올린 점이 좋았습니다.",
        "템포 유지력에 더해 후반 리듬 회복까지 잘 이루어진 러닝이었습니다.",
        "발 리듬 중심의 흐름을 살리면서 마지막까지 좋은 전개를 만들었습니다.",
      ])}`;
    }
    if (splitTrend === "유지") {
      return `${endTrend} ${pickRandom([
        "케이던스와 리듬 유지가 비교적 잘 이어진 러닝이었습니다.",
        "템포 중심 흐름이 비교적 안정적으로 유지된 점이 좋았습니다.",
        "발 리듬을 중심으로 한 주행 흐름이 비교적 잘 살아 있었습니다.",
      ])}`;
    }
    return `${endTrend} ${pickRandom([
      "템포가 조금 줄어드는 흐름이 보여, 다음에는 케이던스 유지에 조금 더 집중해 보세요.",
      "발 회전이 다소 느슨해지는 구간이 보여, 다음에는 템포 유지에 조금 더 신경 써 보세요.",
      "리듬 저하가 약간 나타나, 다음 러닝에서는 템포를 끝까지 유지하는 데 집중해 보세요.",
    ])}`;
  }

  if (formStyle === "스트라이드형") {
    if (splitTrend === "상승") {
      return `${endTrend} ${pickRandom([
        "보폭과 추진 흐름을 잘 살리면서 후반 구간까지 흐름을 끌어올렸습니다.",
        "전진 추진이 후반까지 잘 이어지며 마무리 흐름도 좋았습니다.",
        "보폭 중심 주행이 후반 구간에서 더 잘 살아난 점이 인상적이었습니다.",
      ])}`;
    }
    if (splitTrend === "유지") {
      return `${endTrend} ${pickRandom([
        "보폭과 추진 흐름의 균형이 비교적 잘 유지된 러닝이었습니다.",
        "전진 추진과 리듬의 균형이 비교적 안정적으로 이어졌습니다.",
        "보폭 중심 흐름이 무리 없이 유지된 점이 좋았습니다.",
      ])}`;
    }
    return `${endTrend} ${pickRandom([
      "보폭이 줄어드는 경향이 보여, 다음에는 추진 흐름 유지에 조금 더 집중해 보세요.",
      "후반으로 갈수록 전진 추진이 약해지는 흐름이 보여, 다음에는 보폭 유지에 조금 더 신경 써 보세요.",
      "추진감이 다소 줄어드는 구간이 보여, 다음에는 보폭과 흐름 유지에 더 집중해 보세요.",
    ])}`;
  }

  if (runnerType === "지속형") {
    if (splitTrend === "상승") {
      return `${endTrend} ${pickRandom([
        "전체적으로 안정적인 흐름을 유지하면서 후반 구간까지 더 잘 끌어올렸습니다.",
        "기본 리듬을 지키면서 마지막 흐름까지 잘 살려낸 점이 좋았습니다.",
        "지속형 주행 특성을 유지하면서 후반에도 힘을 잘 남겨두었습니다.",
      ])}`;
    }
    if (splitTrend === "유지") {
      return `${endTrend} ${pickRandom([
        "전체적으로 페이스 배분이 안정적이었고, 지속적인 흐름 유지도 잘 드러난 러닝이었습니다.",
        "무리 없는 속도 배분과 리듬 유지가 비교적 잘 이어진 러닝이었습니다.",
        "큰 무너짐 없이 균형 잡힌 흐름을 유지한 점이 인상적이었습니다.",
      ])}`;
    }
    return `${endTrend} ${pickRandom([
      "유지력이 조금 떨어지는 흐름이 보여, 다음에는 리듬 유지에 조금 더 집중해 보세요.",
      "후반으로 갈수록 흐름 유지가 다소 어려워져, 다음에는 일정한 리듬 유지에 더 신경 써 보세요.",
      "속도 유지가 조금 무거워지는 흐름이 보여, 다음에는 페이스 보존에 조금 더 집중해 보세요.",
    ])}`;
  }

  return `${endTrend} ${pickRandom([
    "전체 흐름은 무난한 편이었습니다.",
    "전반적인 러닝 흐름은 비교적 안정적인 편이었습니다.",
    "전체적인 패턴은 크게 무너지지 않고 이어졌습니다.",
    "큰 기복 없이 비교적 고른 흐름이 이어졌습니다.",
    "전체 흐름이 과하지도 부족하지도 않게 균형 있게 유지되었습니다.",
  ])}`;
}

function buildFinalAiCoachAnalysis({
  runnerType,
  distance,
  duration,
  cadence,
  elevationGain,
  elevationLoss,
  splits,
}: {
  runnerType: RunnerType;
  distance: number;
  duration: number;
  cadence: number;
  elevationGain: number;
  elevationLoss: number;
  splits: RunSplit[];
}) {
  const { paceStyle, formStyle } = deriveFinalReportAxis(runnerType);
  const splitTrend = deriveSplitTrend(splits);

  const closing = getFinalReportClosing({
    runnerType,
    paceStyle,
    formStyle,
    splitTrend,
    splits,
  });

  const base =
    `${distance.toFixed(2)}킬로미터를 ${formatDurationForSpeech(
      duration
    )} 동안 수행했습니다. ` +
    `평균 케이던스는 ${Math.round(cadence)}이며, ` +
    `누적 상승고도는 ${Math.round(elevationGain)}미터, ` +
    `누적 하강고도는 ${Math.round(elevationLoss)}미터였습니다.`;

  const courseComment = getCourseProfileComment(elevationGain, elevationLoss);

  const analysis =
    paceStyle === "변속형"
      ? pickRandom([
          "이번 러닝에서는 구간별 페이스 변화가 비교적 분명하게 나타났고, 가속과 회복이 반복되는 패턴이 확인되었습니다.",
          "이번 러닝에서는 속도 변화 폭이 비교적 크게 나타나며, 변속형 주행 흐름이 뚜렷하게 드러났습니다.",
          "이번 러닝에서는 일정한 리듬 유지보다는 구간 전환 중심의 흐름이 더 선명하게 나타났습니다.",
        ])
      : formStyle === "케이던스형"
      ? pickRandom([
          "이번 러닝에서는 케이던스와 템포 유지 중심의 흐름이 비교적 잘 드러났습니다.",
          "이번 러닝에서는 보폭보다는 발 리듬을 활용한 주행 성향이 더 뚜렷하게 나타났습니다.",
          "이번 러닝에서는 템포 중심의 리듬 운영이 비교적 안정적으로 이어졌습니다.",
        ])
      : formStyle === "스트라이드형"
      ? pickRandom([
          "이번 러닝에서는 보폭을 활용한 추진 흐름이 비교적 뚜렷하게 나타났습니다.",
          "이번 러닝에서는 발 회전보다는 보폭과 전진 추진력이 중심이 되는 패턴이 드러났습니다.",
          "이번 러닝에서는 한 걸음 한 걸음의 추진력이 비교적 잘 살아 있는 흐름이 보였습니다.",
        ])
      : pickRandom([
          "이번 러닝에서는 전체적으로 페이스 흐름이 균형잡힌 편이었습니다.",
          "이번 러닝에서는 큰 기복 없이 비교적 일정한 리듬이 유지되었습니다.",
          "이번 러닝에서는 속도 변화 폭이 크지 않았고, 전반적으로 편안한 흐름이 이어졌습니다.",
        ]);

  return `${base} ${courseComment} ${analysis} ${closing}`;
}

export default function RunningScreen() {
  const navigation = useNavigation();
  const mapRef = useRef<MapView | null>(null);
  const allowExitRef = useRef(false);
  const gpsTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const permissionFlowRunningRef = useRef(false);
  const modalLockRef = useRef(false);
  const lastGpsNoticeSessionIdRef = useRef<string | null>(null);
  const didEnterFollowZoomRef = useRef(false);
  const didApplyFinishFitRef = useRef(false);
  const userMapInteractingRef = useRef(false);
  const lastUserMapTouchAtRef = useRef(0);

  const restoringRef = useRef(false);
  const lastRestoreAtRef = useRef(0);

  const userToggledPrepRef = useRef(false);

  const loadVoiceSettingsRef = useRef<(() => Promise<void>) | null>(null);
  const refreshSessionRef = useRef<
    (() => Promise<NativeSessionPayload | null>) | null
  >(null);
  const bootstrapPermissionFlowRef = useRef<
    ((silent?: boolean) => Promise<void>) | null
  >(null);
  const applySessionRef = useRef<
    ((next: NativeSessionPayload | null) => void) | null
  >(null);
  const refreshBatteryOptimizationStatusRef = useRef<
    (() => Promise<void>) | null
  >(null);
  const runRestoreSafelyRef = useRef<
    ((force?: boolean) => Promise<void>) | null
  >(null);

  const [session, setSession] = useState<NativeSessionPayload | null>(null);
  const [finishedSnapshot, setFinishedSnapshot] = useState<RunData | null>(null);
  const [currentLocation, setCurrentLocation] = useState<RoutePoint | null>(null);

  const [permissionReady, setPermissionReady] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [notificationReady, setNotificationReady] = useState(
    Platform.OS !== "android"
  );
  const [locationStatusText, setLocationStatusText] = useState("GPS 확인 중");
  const [gpsTimeout, setGpsTimeout] = useState(false);

  const [targetMode, setTargetMode] = useState<
    "free" | "3" | "5" | "10" | "21.1" | "42.2" | "custom"
  >("free");
  const [customTargetText, setCustomTargetText] = useState("");

  const [reportVoiceEnabled, setReportVoiceEnabled] = useState(true);
  const [coachVoiceEnabled, setCoachVoiceEnabled] = useState(true);

  const [prepExpanded, setPrepExpanded] = useState(true);
  const [lastFinishedRunId, setLastFinishedRunId] = useState<string | null>(
    null
  );
  const [needsBatteryOptimization, setNeedsBatteryOptimization] =
    useState(false);

  const [resumePending, setResumePending] = useState(false);
  const [lastValidPace, setLastValidPace] = useState(0);
  const [resumeGraceUntil, setResumeGraceUntil] = useState(0);
  const [pendingFinish, setPendingFinish] = useState(false);
  const [startButtonReady, setStartButtonReady] = useState(false);

  const activeDisplayRouteSegments = useMemo(() => {
    return buildDisplaySegments(session?.routeSegments ?? []);
  }, [session?.routeSegments]);

  const activeFlatRoute = useMemo(() => {
    return activeDisplayRouteSegments.flat();
  }, [activeDisplayRouteSegments]);

  const finishedDisplayRouteSegments = useMemo(() => {
    return buildDisplaySegments(
      finishedSnapshot?.routeSegments ??
        (finishedSnapshot?.route?.length ? [finishedSnapshot.route] : [])
    );
  }, [finishedSnapshot?.routeSegments, finishedSnapshot?.route]);

  const finishedFlatRoute = useMemo(() => {
    return finishedDisplayRouteSegments.flat();
  }, [finishedDisplayRouteSegments]);

  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const releaseModalLock = () => {
    setTimeout(() => {
      modalLockRef.current = false;
    }, 250);
  };

  const showLockedAlert = (
    title: string,
    message: string,
    buttons: AlertBtn[]
  ) => {
    if (modalLockRef.current) return false;

    modalLockRef.current = true;

    const wrappedButtons = buttons.map((button) => ({
      text: button.text,
      style: button.style,
      onPress: () => {
        const result = button.onPress?.();

        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>)
            .catch((error) => {
              console.log("Alert button error:", error);
            })
            .finally(() => {
              releaseModalLock();
            });
        } else {
          releaseModalLock();
        }
      },
    }));

    Alert.alert(title, message, wrappedButtons, {
      cancelable: true,
      onDismiss: () => {
        releaseModalLock();
      },
    });
    return true;
  };

  const askLockedAlert = async (
    title: string,
    message: string,
    okText = "확인"
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await new Promise<boolean | null>((resolve) => {
        const shown = showLockedAlert(title, message, [
          {
            text: "나중에",
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: okText,
            onPress: () => resolve(true),
          },
        ]);

        if (!shown) {
          resolve(null);
        }
      });

      if (result !== null) {
        return result;
      }

      await wait(250);
    }

    return false;
  };

  const applySession = (next: NativeSessionPayload | null) => {
    if (!next) {
      setSession(null);
      return;
    }

    if (!next.isRunning && !next.isPaused && !pendingFinish) {
      setSession(null);
      return;
    }

    setSession(next);

    if (next.lastPoint) {
      setCurrentLocation(next.lastPoint);
      if (!next.autoPausedByGpsLoss) {
        setGpsTimeout(false);
      }
    }

    if (!next.isPaused && isUsableCurrentPace(next.currentPaceSec)) {
      setLastValidPace(next.currentPaceSec);
    }

    if (next.autoPausedByGpsLoss && next.sessionId) {
      if (lastGpsNoticeSessionIdRef.current !== next.sessionId) {
        lastGpsNoticeSessionIdRef.current = next.sessionId;
        setGpsTimeout(true);
        setLocationStatusText("GPS 신호 끊김으로 자동 일시정지됨");

        showLockedAlert(
          "GPS 신호 끊김",
          "GPS 신호 끊김으로 자동 일시정지되었습니다. 신호가 회복되면 재개 버튼을 눌러 다시 시작해 주세요.",
          [{ text: "확인" }]
        );
      }
    } else if (!next.autoPausedByGpsLoss) {
      lastGpsNoticeSessionIdRef.current = null;
    }
  };

  const refreshSession = async (): Promise<NativeSessionPayload | null> => {
    try {
      if (!RunholicForeground?.getCurrentSession) return null;

      const raw = await RunholicForeground.getCurrentSession();
      const normalized = normalizeNativeSession(raw);

      if (!normalized?.isRunning && !normalized?.sessionId) {
        setSession(null);
        return null;
      }

      if (!normalized.isRunning && !normalized.isPaused && !pendingFinish) {
        setSession(null);
        return null;
      }

      applySession(normalized);
      return normalized;
    } catch (error) {
      console.log("getCurrentSession error:", error);
      return null;
    }
  };

  const resetIdleRunningScreen = async () => {
    setSession(null);
    setFinishedSnapshot(null);
    setLastFinishedRunId(null);
    setLastValidPace(0);
    setPendingFinish(false);
    setGpsTimeout(false);
    setPrepExpanded(true);
    didEnterFollowZoomRef.current = false;
    didApplyFinishFitRef.current = false;
    userMapInteractingRef.current = false;
    lastUserMapTouchAtRef.current = 0;
    userToggledPrepRef.current = false;
    setResumeGraceUntil(0);

    await loadCurrentLocation();
  };

  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;

    const now = Date.now();

    if (userMapInteractingRef.current) {
      if (now - lastUserMapTouchAtRef.current < 2000) return;
      userMapInteractingRef.current = false;
    }

    if (session?.isRunning && !session.isPaused) {
      let delta = EARLY_RUN_MAP_DELTA;

      if (activeFlatRoute.length >= 2) {
        const lats = activeFlatRoute.map((p) => p.latitude);
        const lngs = activeFlatRoute.map((p) => p.longitude);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        const latSpan = maxLat - minLat;
        const lngSpan = maxLng - minLng;

        if (!didEnterFollowZoomRef.current && (latSpan > 0.0006 || lngSpan > 0.0008)) {
          didEnterFollowZoomRef.current = true;
        }
      }

      if (didEnterFollowZoomRef.current) {
        delta = FOLLOW_MAP_DELTA;
      }

      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: delta,
          longitudeDelta: delta,
        },
        250
      );
      return;
    }

    didEnterFollowZoomRef.current = false;

    if (finishedFlatRoute.length >= 2) {
      if (!didApplyFinishFitRef.current) {
        didApplyFinishFitRef.current = true;
        mapRef.current.fitToCoordinates(finishedFlatRoute, {
          edgePadding: {
            top: 30,
            right: 30,
            bottom: 30,
            left: 30,
          },
          animated: false,
        });
      }
      return;
    }

    mapRef.current.animateToRegion(
      {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: IDLE_MAP_DELTA,
        longitudeDelta: IDLE_MAP_DELTA,
      },
      0
    );
  }, [
    currentLocation,
    session?.isRunning,
    session?.isPaused,
    session?.routeSegments,
    finishedSnapshot?.routeSegments,
    finishedSnapshot?.route,
  ]);

  useEffect(() => {
    const onBackPress = () => {
      if (session?.isRunning) {
        confirmExitRunning();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress
    );

    return () => subscription.remove();
  }, [session?.isRunning]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      if (!session?.isRunning || allowExitRef.current) return;

      e.preventDefault();
      confirmExitRunning();
    });

    return unsubscribe;
  }, [navigation, session?.isRunning]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("blur", () => {
      if (session?.isRunning) return;

      setFinishedSnapshot(null);
      setLastFinishedRunId(null);
      setLastValidPace(0);
      setPendingFinish(false);
      setGpsTimeout(false);
    });

    return unsubscribe;
  }, [navigation, session?.isRunning]);

  const loadVoiceSettings = async () => {
    const saved = await loadRunVoiceSettings();
    setReportVoiceEnabled(saved.reportVoiceEnabled);
    setCoachVoiceEnabled(saved.coachVoiceEnabled);

    await syncVoiceSettingsToNative(
      saved.reportVoiceEnabled,
      saved.coachVoiceEnabled
    );
  };

  const syncVoiceSettingsToNative = async (
    reportEnabled: boolean,
    coachEnabled: boolean
  ) => {
    try {
      await RunholicForeground?.updateVoiceSettings?.(
        reportEnabled,
        coachEnabled
      );
    } catch (error) {
      console.log("updateVoiceSettings native error:", error);
    }
  };

  const updateVoiceSettings = async (
    next: Partial<{
      reportVoiceEnabled: boolean;
      coachVoiceEnabled: boolean;
    }>
  ) => {
    const updated = {
      reportVoiceEnabled:
        typeof next.reportVoiceEnabled === "boolean"
          ? next.reportVoiceEnabled
          : reportVoiceEnabled,
      coachVoiceEnabled:
        typeof next.coachVoiceEnabled === "boolean"
          ? next.coachVoiceEnabled
          : coachVoiceEnabled,
    };

    setReportVoiceEnabled(updated.reportVoiceEnabled);
    setCoachVoiceEnabled(updated.coachVoiceEnabled);
    await saveRunVoiceSettings(updated);

    await syncVoiceSettingsToNative(
      updated.reportVoiceEnabled,
      updated.coachVoiceEnabled
    );
  };

  const restoreRunningState = async () => {
    const current = await RunholicForeground?.getCurrentSession?.().catch(
      () => null
    );
    const normalized = normalizeNativeSession(current);

    if (!normalized || !normalized.isRunning || normalized.isPaused) return;

    try {
      await RunholicForeground.ensureNotification?.();
    } catch (error) {
      console.log("ensureNotification error:", error);
    }

    try {
      const currentPos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const point: RoutePoint = {
        latitude: currentPos.coords.latitude,
        longitude: currentPos.coords.longitude,
        altitude: currentPos.coords.altitude,
        timestamp: currentPos.timestamp ?? Date.now(),
        accuracy: currentPos.coords.accuracy,
      };

      setCurrentLocation(point);
    } catch (error) {
      console.log("restoreRunningState location error:", error);
    }
  };

  const runRestoreSafely = async (force = false) => {
    const now = Date.now();

    if (restoringRef.current) return;
    if (!force && now - lastRestoreAtRef.current < 1500) return;

    restoringRef.current = true;
    lastRestoreAtRef.current = now;

    try {
      const active = await refreshSession();
      if (active?.isRunning) {
        if (!userToggledPrepRef.current) {
          setPrepExpanded(false);
        }
        await restoreRunningState();
      } else {
        await resetIdleRunningScreen();
      }
    } finally {
      restoringRef.current = false;
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void refreshBatteryOptimizationStatusRef.current?.();
      void runRestoreSafelyRef.current?.(true);
    });

    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState !== "active") return;

        userToggledPrepRef.current = false;

        InteractionManager.runAfterInteractions(async () => {
          await refreshBatteryOptimizationStatusRef.current?.();
          await runRestoreSafelyRef.current?.(true);
        });
      }
    );

    return () => sub.remove();
  }, []);

  const loadCurrentLocation = async () => {
    setLocationStatusText("GPS 위치 확인 중");

    if (gpsTimeoutTimerRef.current) {
      clearTimeout(gpsTimeoutTimerRef.current);
      gpsTimeoutTimerRef.current = null;
    }

    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const point: RoutePoint = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        altitude: current.coords.altitude,
        timestamp: current.timestamp ?? Date.now(),
        accuracy: current.coords.accuracy,
      };

      const accuracy = point.accuracy ?? 999;
      let ready = gpsReady;

      if (!gpsReady && accuracy <= 40) {
        ready = true;
      }

      setCurrentLocation(point);
      setGpsReady(ready);
      setGpsTimeout(false);
      setLocationStatusText(
        ready
          ? "GPS 준비 완료"
          : `GPS 정확도 보정 중 (${Math.round(accuracy)}m)`
      );
    } catch {
      setGpsReady(false);
      setLocationStatusText("GPS 신호 확인 중");

      gpsTimeoutTimerRef.current = setTimeout(() => {
        setGpsTimeout(true);
        setLocationStatusText("GPS 신호가 약합니다");
      }, 8000);
    }
  };

  useEffect(() => {
    if (gpsReady) return;
    if (session?.isRunning) return;
    if (!permissionReady) return;

    let running = false;

    const interval = setInterval(async () => {
      if (running) return;

      running = true;
      try {
        await loadCurrentLocation();
      } finally {
        running = false;
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [gpsReady, session?.isRunning, permissionReady]);

  useEffect(() => {
    if (gpsReady && gpsTimeoutTimerRef.current) {
      clearTimeout(gpsTimeoutTimerRef.current);
      gpsTimeoutTimerRef.current = null;
    }
  }, [gpsReady]);

  const requestNotificationPermission = async () => {
    const requested = await Notifications.requestPermissionsAsync();

    const granted =
      requested.granted ||
      requested.ios?.status ===
        Notifications.IosAuthorizationStatus.AUTHORIZED;

    setNotificationReady(granted);
    return granted;
  };

  const requestBackgroundPermission = async () => {
    const bg = await Location.requestBackgroundPermissionsAsync();
    const granted = bg.status === "granted";

    setBackgroundReady(granted);
    return granted;
  };

  const requestForegroundPermission = async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    const granted = fg.status === "granted";

    setPermissionReady(granted);

    if (!granted) {
      setGpsReady(false);
      setGpsTimeout(false);
    }

    return granted;
  };

  const promptBatteryOptimizationSetup = () => {
    if (Platform.OS !== "android") return;

    showLockedAlert(
      "배터리 사용 제한 변경 안내",
      "화면이 꺼져도 러닝 추적과 음성 안내가 안정적으로 유지되도록, RUNHOLIC 앱의 배터리 사용 제한을 '제한 없음'으로 바꿔주세요.",
      [
        { text: "나중에", style: "cancel" },
        {
          text: "설정 열기",
          onPress: async () => {
            try {
              await IntentLauncher.startActivityAsync(
                IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
              );
              return;
            } catch (e) {
              console.log("배터리 리스트 실패:", e);
            }

            try {
              await IntentLauncher.startActivityAsync(
                IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
                { data: "package:com.starbion.runholic" }
              );
              return;
            } catch (e) {
              console.log("앱 상세 실패:", e);
            }

            try {
              await Linking.openSettings();
            } catch (e) {
              console.log("설정 열기 실패:", e);
            }
          },
        },
      ]
    );
  };

  const refreshBatteryOptimizationStatus = async () => {
    if (Platform.OS !== "android") {
      setNeedsBatteryOptimization(false);
      return;
    }

    try {
      const enabled = await Battery.isBatteryOptimizationEnabledAsync();

      if (enabled) {
        setNeedsBatteryOptimization(true);
        await AsyncStorage.removeItem(BATTERY_OPT_DISABLED_KEY);
      } else {
        setNeedsBatteryOptimization(false);
        await AsyncStorage.setItem(BATTERY_OPT_DISABLED_KEY, "1");
      }
    } catch (error) {
      console.log("Battery optimization check error:", error);
    }
  };

  const runPermissionSequence = async () => {
    if (permissionFlowRunningRef.current) return;
    permissionFlowRunningRef.current = true;

    try {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();

      let fgGranted = fg.status === "granted";
      let bgGranted = bg.status === "granted";

      setPermissionReady(fgGranted);
      setBackgroundReady(bgGranted);

      if (!fgGranted) {
        const shouldRequestFg = await askLockedAlert(
          "위치 권한 허용 안내",
          "러닝 거리, 페이스, 지도 기록을 위해 위치 권한의 '앱 사용 중에만 허용'이 필요합니다.",
          "권한 허용"
        );

        if (!shouldRequestFg) {
          setGpsReady(false);
          setGpsTimeout(false);
          return;
        }

        fgGranted = await requestForegroundPermission();
        if (!fgGranted) return;

        await wait(600);
      }

      const notificationSettings = await Notifications.getPermissionsAsync();
      let notificationGranted =
        notificationSettings.granted ||
        notificationSettings.ios?.status ===
          Notifications.IosAuthorizationStatus.AUTHORIZED;

      setNotificationReady(notificationGranted);

      if (!notificationGranted) {
        const shouldRequestNotification = await askLockedAlert(
          "알림 권한 허용 안내",
          "백그라운드 러닝 추적 상태를 상태표시줄에 표시하려면 알림 권한 '허용'이 필요합니다.",
          "권한 허용"
        );

        if (!shouldRequestNotification) {
          setNotificationReady(false);
          return;
        }

        notificationGranted = await requestNotificationPermission();
        if (!notificationGranted) return;

        await wait(600);
      }

      const bgAfterNotification = await Location.getBackgroundPermissionsAsync();
      bgGranted = bgAfterNotification.status === "granted";
      setBackgroundReady(bgGranted);

      if (!bgGranted) {
        const shouldRequestBg = await askLockedAlert(
          "백그라운드 위치 권한 허용 안내",
          "화면이 꺼져도 러닝 기록과 음성 안내를 유지하려면 백그라운드 위치 권한을 '항상 허용'으로 바꿔주세요.",
          "권한 허용"
        );

        if (!shouldRequestBg) {
          setBackgroundReady(false);
          return;
        }

        bgGranted = await requestBackgroundPermission();
        if (!bgGranted) return;

        await wait(600);
      }

      if (Platform.OS === "android") {
        const batteryOptimizationEnabled =
          await Battery.isBatteryOptimizationEnabledAsync().catch(() => true);

        if (batteryOptimizationEnabled) {
          setNeedsBatteryOptimization(true);
          await AsyncStorage.removeItem(BATTERY_OPT_DISABLED_KEY);

          promptBatteryOptimizationSetup();
          return;
        }

        setNeedsBatteryOptimization(false);
        await AsyncStorage.setItem(BATTERY_OPT_DISABLED_KEY, "1");
      } else {
        setNeedsBatteryOptimization(false);
      }

      await loadCurrentLocation();
    } finally {
      permissionFlowRunningRef.current = false;
    }
  };

  const bootstrapPermissionFlow = async (silent = false) => {
    if (silent) {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();

      const fgGranted = fg.status === "granted";
      const bgGranted = bg.status === "granted";

      setPermissionReady(fgGranted);
      setBackgroundReady(bgGranted);

      if (fgGranted) {
        await loadCurrentLocation();
      } else {
        setGpsReady(false);
        setGpsTimeout(false);
      }

      if (Platform.OS === "android") {
        const settings = await Notifications.getPermissionsAsync();
        const granted =
          settings.granted ||
          settings.ios?.status ===
            Notifications.IosAuthorizationStatus.AUTHORIZED;
        setNotificationReady(granted);
      }

      return;
    }

    await runPermissionSequence();
  };

  loadVoiceSettingsRef.current = loadVoiceSettings;
  refreshSessionRef.current = refreshSession;
  bootstrapPermissionFlowRef.current = bootstrapPermissionFlow;
  applySessionRef.current = applySession;
  refreshBatteryOptimizationStatusRef.current =
    refreshBatteryOptimizationStatus;
  runRestoreSafelyRef.current = runRestoreSafely;

  useEffect(() => {
    const init = async () => {
      await loadVoiceSettingsRef.current?.();
      await refreshSessionRef.current?.();
      await bootstrapPermissionFlowRef.current?.();
      loadInterstitial();
    };

    void init();

    const emitter = getNativeEmitter();
    const sub = emitter?.addListener?.("onSessionUpdate", (payload: any) => {
      const normalized = normalizeNativeSession(payload);
      if (!normalized) return;
      applySessionRef.current?.(normalized);
    });

    return () => {
      if (gpsTimeoutTimerRef.current) {
        clearTimeout(gpsTimeoutTimerRef.current);
      }

      sub?.remove?.();
    };
  }, []);

  const resolvedTargetDistanceKm =
    targetMode === "free"
      ? null
      : targetMode === "custom"
      ? (() => {
          const parsed = Number(customTargetText);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        })()
      : Number(targetMode);

  useEffect(() => {
    if (!session?.isRunning) return;
    if (!RunholicForeground?.updateTargetDistance) return;

    const nextTargetKm = resolvedTargetDistanceKm ?? -1;

    const currentTargetKm =
      session.targetDistanceKm && session.targetDistanceKm > 0
        ? session.targetDistanceKm
        : -1;

    if (Math.abs(currentTargetKm - nextTargetKm) < 0.0001) return;

    RunholicForeground.updateTargetDistance(nextTargetKm)
      .then(() => refreshSession())
      .catch((error: any) => {
        console.log("updateTargetDistance error:", error);
      });
  }, [resolvedTargetDistanceKm, session?.isRunning, session?.targetDistanceKm]);

  const targetSummaryText = resolvedTargetDistanceKm
    ? `${resolvedTargetDistanceKm.toFixed(2)}km`
    : "자유 러닝";

  const prepStatusText =
    !permissionReady
      ? "위치 권한 확인 중..."
      : !notificationReady
      ? "알림 권한 확인 중..."
      : !backgroundReady
      ? "백그라운드 권한 확인 중..."
      : needsBatteryOptimization
      ? "배터리 최적화 예외 필요"
      : !gpsReady
      ? locationStatusText || "GPS 수신 중..."
      : "위치·알림·백그라운드·배터리·GPS 설정 완료";

  const prepSummaryText =
    Platform.OS === "android"
      ? `${targetSummaryText} · 상태 ${
          reportVoiceEnabled ? "ON" : "OFF"
        } · 코칭 ${coachVoiceEnabled ? "ON" : "OFF"}${
          needsBatteryOptimization ? " · 절전 설정 필요" : ""
        }${notificationReady ? "" : " · 알림 권한 필요"}`
      : `${targetSummaryText} · 상태 ${
          reportVoiceEnabled ? "ON" : "OFF"
        } · 코칭 ${coachVoiceEnabled ? "ON" : "OFF"}`;

  const handlePermissionRetry = async () => {
    permissionFlowRunningRef.current = false;
    modalLockRef.current = false;

    await wait(80);
    await refreshBatteryOptimizationStatus();
    await runPermissionSequence();
  };

  const handleStart = async () => {
    if (!RunholicForeground?.startRun) {
      return;
    }

    if (
      !permissionReady ||
      !backgroundReady ||
      !notificationReady ||
      needsBatteryOptimization
    ) {
      await runPermissionSequence();
      return;
    }

    if (!gpsReady || !currentLocation) {
      await loadCurrentLocation();
      return;
    }

    const profile = await loadProfile();
    if (!profile) {
      showLockedAlert(
        "프로필 입력 필요",
        "러닝 시작 전에 키, 몸무게, 성별, 보폭 프로필을 먼저 입력해주세요.",
        [
          { text: "취소", style: "cancel" },
          {
            text: "프로필 입력",
            onPress: () => router.push("/profile-setup"),
          },
        ]
      );
      return;
    }

    const runnerType = await getRunnerTypeFromHistory();
    const runnerTrait = await getRunnerTraitFromHistory();

    const sessionId = String(Date.now());

    try {
      await RunholicForeground.startRun(
        sessionId,
        resolvedTargetDistanceKm ?? -1,
        profile.weightKg,
        profile.strideCm,
        profile.heightCm,
        profile.sex,
        runnerType,
        runnerTrait
      );
    } catch (error: any) {
      console.log("startRun error raw:", error);
      console.log("startRun error message:", error?.message);
      console.log("startRun error code:", error?.code);
      console.log("startRun error stack:", error?.stack);
      return;
    }

    setLastFinishedRunId(null);
    setFinishedSnapshot(null);
    setPrepExpanded(false);
    setLastValidPace(0);
    didEnterFollowZoomRef.current = false;
    didApplyFinishFitRef.current = false;
    userMapInteractingRef.current = false;
    lastUserMapTouchAtRef.current = 0;
    setResumeGraceUntil(0);

    await refreshSession();
  };

  const handlePause = async () => {

    try {
      await RunholicForeground.pauseRun();
      await refreshSession();
    } catch (error) {
      console.log("pauseRun error:", error);
    }

    setGpsTimeout(false);
  };

  const handleResume = async () => {
    if (resumePending) return;
    setResumePending(true);
    setResumeGraceUntil(Date.now() + 5000);

    try {
      await RunholicForeground.resumeRun();
      await refreshSession();
      setGpsTimeout(false);
      setLocationStatusText("GPS 위치 확인 중");

    } catch (error) {
      console.log("resumeRun error:", error);
    } finally {
      setResumePending(false);
    }
  };

  const applyFinishFitOnce = (routeSegments?: RoutePoint[][]) => {
    if (didApplyFinishFitRef.current) return;
    if (!mapRef.current) return;

    const segments = buildDisplaySegments(routeSegments ?? session?.routeSegments ?? []);
    const flat = segments.flat();

    if (flat.length < 2) return;

    didApplyFinishFitRef.current = true;

    mapRef.current.fitToCoordinates(flat, {
      edgePadding: {
        top: 30,
        right: 30,
        bottom: 30,
        left: 30,
      },
      animated: false,
    });
  };

  const handleFinish = async () => {
    if (pendingFinish) return;

    try {
      setPendingFinish(true);
      await RunholicForeground.stopRun();
      applyFinishFitOnce(session?.routeSegments);
    } catch (error) {
      console.log("stopRun error:", error);
      setPendingFinish(false);
      showLockedAlert("러닝 종료", "러닝 종료 처리 중 문제가 발생했습니다.", [
        { text: "확인" },
      ]);
    }
  };

  useEffect(() => {
    if (!pendingFinish) return;
    if (!session) return;
    if (session.isRunning) return;
    if (!session.sessionId) return;
    if (lastFinishedRunId === session.sessionId) return;

    let cancelled = false;

    const finalizeRun = async () => {
      const finalRun = buildRunDataFromNative(session);

      finalRun.aiCoachAnalysis = buildFinalAiCoachAnalysis({
        runnerType: finalRun.runnerType,
        distance: finalRun.distance,
        duration: finalRun.duration,
        cadence: finalRun.cadence,
        elevationGain: finalRun.elevationGain,
        elevationLoss: finalRun.elevationLoss,
        splits: finalRun.splits,
      });

      try {
        await saveLastRun(finalRun);
        await saveRunHistory(finalRun);

      } catch (error) {
        console.log("save result error:", error);
        if (!cancelled) {
          showLockedAlert("러닝 종료", "러닝 결과 저장 중 문제가 발생했습니다.", [
            { text: "확인" },
          ]);
          setPendingFinish(false);
        }
        return;
      }

      if (cancelled) return;

      setFinishedSnapshot(finalRun);

      if (finalRun.route?.length) {
        setCurrentLocation(finalRun.route[finalRun.route.length - 1]);
      }

      setLastFinishedRunId(finalRun.id);
      setPendingFinish(false);
      setSession(null);

      setGpsTimeout(false);
      setLocationStatusText("GPS 준비 완료");
    };

    void finalizeRun();

    return () => {
      cancelled = true;
    };
  }, [pendingFinish, session]);

  const handleViewResult = async () => {
    if (!lastFinishedRunId) return;

    await new Promise(r => setTimeout(r, 150));

    try {
      showInterstitial(() => {
        router.replace({
          pathname: "/result",
          params: { id: lastFinishedRunId },
        });
      });
    } catch {
      router.replace({
        pathname: "/result",
        params: { id: lastFinishedRunId },
      });
    }
  };

  const confirmExitRunning = () => {
    const shown = showLockedAlert(
      "현재 러닝 종료",
      "뒤로 가면 현재 러닝이 저장되지 않고 종료됩니다. 홈으로 이동하시겠습니까?\n(기록을 저장하려면 화면 하단의 '러닝 종료' 버튼을 눌러 정식으로 종료해 주세요.)",
      [
        { text: "취소", style: "cancel" },
        {
          text: "저장 없이 종료",
          style: "destructive",
          onPress: async () => {
            try {
              await RunholicForeground.stopRun();
            } catch (error) {
              console.log("stopRun on exit error:", error);
            }

            setPendingFinish(false);
            setSession(null);
            setGpsTimeout(false);
            allowExitRef.current = true;
            router.back();
          },
        },
      ]
    );

    if (!shown) {
      releaseModalLock();
    }
  };

  const canStartRun =
    permissionReady &&
    backgroundReady &&
    gpsReady &&
    notificationReady &&
    !needsBatteryOptimization &&
    !session?.isRunning &&
    (targetMode !== "custom" || resolvedTargetDistanceKm !== null);

  const showPermissionRetryButton =
    !session?.isRunning &&
    (
      !permissionReady ||
      !backgroundReady ||
      !notificationReady ||
      needsBatteryOptimization ||
      !gpsReady
    );

  useEffect(() => {
    setStartButtonReady(canStartRun);
  }, [canStartRun]);

  const displaySession =
    session?.isRunning || session?.isPaused ? session : finishedSnapshot;

  const coachAnalysisText =
    displaySession?.aiCoachAnalysis ??
    finishedSnapshot?.aiCoachAnalysis ??
    "러닝을 시작하면 AI코치 분석이 표시됩니다.";

  const displayDuration = (() => {
    if (!displaySession) return 0;

    if ("elapsedMs" in displaySession) {
      return Math.max(Math.floor(displaySession.elapsedMs / 1000), 0);
    }

    return Math.max(displaySession.duration ?? 0, 0);
  })();

  const displayAvgPace =
    displaySession && "avgPaceSec" in displaySession
      ? displaySession.avgPaceSec ?? 0
      : displaySession && "pace" in displaySession
      ? displaySession.pace ?? 0
      : 0;

  const isResumeGrace =
    !!session?.isRunning &&
    !session?.isPaused &&
    Date.now() < resumeGraceUntil;

  const displayCurrentPace =
    session?.isPaused || isResumeGrace
      ? 0
      : isUsableCurrentPace(session?.currentPaceSec)
      ? session.currentPaceSec
      : finishedSnapshot?.pace && finishedSnapshot.pace > 0
      ? finishedSnapshot.pace
      : lastValidPace;

  const renderMap = () => {
    if (!currentLocation) {
      return (
        <View style={styles.mapLoadingCard}>
          <Text style={styles.mapLoadingPlaceholder}>지도 로딩 중</Text>
        </View>
      );
    }

    const liveSession =
      session && (session.isRunning || session.isPaused) ? session : null;

    const displayRouteSegments =
      liveSession?.routeSegments != null
        ? activeDisplayRouteSegments
        : finishedDisplayRouteSegments;

    const flatRoute =
      liveSession?.routeSegments != null
        ? activeFlatRoute
        : finishedFlatRoute;

    return (
      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            latitudeDelta: IDLE_MAP_DELTA,
            longitudeDelta: IDLE_MAP_DELTA,
          }}
          onTouchStart={() => {
            userMapInteractingRef.current = true;
            lastUserMapTouchAtRef.current = Date.now();
          }}
          onPanDrag={() => {
            userMapInteractingRef.current = true;
            lastUserMapTouchAtRef.current = Date.now();
          }}
          onRegionChangeComplete={() => {
            if (userMapInteractingRef.current) {
              lastUserMapTouchAtRef.current = Date.now();
            }
          }}
        >

          {flatRoute.length > 0 && (
            <>
              {displayRouteSegments.map((segment, index) => (
                <Polyline
                  key={`segment-${index}`}
                  coordinates={segment}
                  strokeWidth={4}
                  strokeColor="#4DA6FF"
                />
              ))}
              <Marker coordinate={flatRoute[0]} title="시작" />
            </>
          )}

          <Marker coordinate={currentLocation} title="현재 위치" />
        </MapView>

        {session?.isPaused && session?.autoPausedByGpsLoss && (
          <View style={styles.mapStatusOverlay}>
            <Text style={styles.mapStatusOverlayText}>
              GPS 신호 끊김으로
              {"\n"}
              자동 일시정지됨
              {"\n"}
              GPS 신호 복구 대기 중
            </Text>
          </View>
        )}
      </View>
    );
  };

  void gpsTimeout;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: 24,
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => {
              if (session?.isRunning) {
                confirmExitRunning();
                return;
              }
              router.back();
            }}
            style={styles.headerSideButton}
          >
            <Text style={styles.backText}>← 뒤로</Text>
          </Pressable>

          <Text style={styles.headerTitle}>현재 러닝</Text>
          <View style={styles.headerSideButton} />
        </View>

        <View style={styles.preMapStatusCard}>
          <View style={styles.preMapStatusRow}>
            <Text style={styles.preMapStatusText} numberOfLines={1}>
              {prepStatusText}
            </Text>

            {showPermissionRetryButton && (
              <Pressable
                style={styles.retryBtn}
                onPress={handlePermissionRetry}
              >
                <Text style={styles.retryBtnText}>권한 재요청</Text>
              </Pressable>
            )}
          </View>
        </View>

        {renderMap()}

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>거리</Text>
            <Text style={styles.value}>
              {displaySession
                ? "distanceMeters" in displaySession
                  ? (displaySession.distanceMeters / 1000).toFixed(2)
                  : displaySession.distance.toFixed(2)
                : "0.00"}{" "}
              km
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>러닝 시간</Text>
            <Text style={styles.value}>{formatDuration(displayDuration)}</Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>현재 페이스</Text>
            <Text style={styles.value}>
              {formatPace(displayCurrentPace)}
              /km
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>평균 페이스</Text>
            <Text style={styles.value}>
              {formatPace(displayAvgPace)}
              /km
            </Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>평균 케이던스</Text>
            <Text style={styles.value}>
              {Math.round(
                session?.cadence ??
                  finishedSnapshot?.cadence ??
                  0
              )}{" "}
              spm
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>칼로리</Text>
            <Text style={styles.value}>
              {Math.round(
                session?.calories ??
                  finishedSnapshot?.calories ??
                  0
              )}{" "}
              kcal
            </Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>누적 상승 고도</Text>
            <Text style={styles.value}>
              {Math.round(
                session?.elevationGainMeters ??
                  finishedSnapshot?.elevationGain ??
                  0
              )}{" "}
              m
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>누적 하강 고도</Text>
            <Text style={styles.value}>
              {Math.round(
                session?.elevationLossMeters ??
                  finishedSnapshot?.elevationLoss ??
                  0
              )}{" "}
              m
            </Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>페이스 상태</Text>
            <Text style={styles.value}>
              {finishedSnapshot
                ? "종료"
                : session?.paceState ?? "안정"}
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>평균 대비</Text>
            <Text style={styles.value}>
              {finishedSnapshot
                ? "종료"
                : session?.avgPaceLevel ?? "보통"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Pressable
            style={styles.prepHeaderRow}
            onPress={() => {
              userToggledPrepRef.current = true;
              setPrepExpanded((prev) => !prev);
            }}
          >
            <View style={styles.prepHeaderTextWrap}>
              <Text style={styles.prepHeaderTitle}>러닝 준비 설정</Text>
              <Text style={styles.prepHeaderSummary}>{prepSummaryText}</Text>
            </View>

            <Ionicons
              name={prepExpanded ? "chevron-up" : "chevron-down"}
              size={24}
              color="#DCE6FF"
              style={styles.prepHeaderArrow}
            />
          </Pressable>
        </View>

        {prepExpanded && (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>목표 거리 설정</Text>

              <View style={styles.goalRow}>
                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "free" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("free")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "free" && styles.goalChipTextActive,
                    ]}
                  >
                    자유 러닝
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "3" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("3")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "3" && styles.goalChipTextActive,
                    ]}
                  >
                    3km
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "5" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("5")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "5" && styles.goalChipTextActive,
                    ]}
                  >
                    5km
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "10" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("10")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "10" && styles.goalChipTextActive,
                    ]}
                  >
                    10km
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "21.1" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("21.1")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "21.1" && styles.goalChipTextActive,
                    ]}
                  >
                    하프 21.10km
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "42.2" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("42.2")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "42.2" && styles.goalChipTextActive,
                    ]}
                  >
                    풀 42.20km
                  </Text>
                </Pressable>
              </View>

              <View style={styles.goalCustomRow}>
                <Pressable
                  style={[
                    styles.goalChip,
                    targetMode === "custom" && styles.goalChipActive,
                  ]}
                  onPress={() => setTargetMode("custom")}
                >
                  <Text
                    style={[
                      styles.goalChipText,
                      targetMode === "custom" && styles.goalChipTextActive,
                    ]}
                  >
                    직접 입력
                  </Text>
                </Pressable>

                {targetMode === "custom" && (
                  <TextInput
                    value={customTargetText}
                    onChangeText={setCustomTargetText}
                    placeholder="예: 7 또는 7.53"
                    placeholderTextColor="#7F8AA3"
                    keyboardType="decimal-pad"
                    style={styles.goalInput}
                  />
                )}
              </View>

              <Text style={styles.goalHint}>
                {resolvedTargetDistanceKm
                  ? `현재 목표 거리: ${resolvedTargetDistanceKm.toFixed(2)}km`
                  : "현재 목표 거리: 자유 러닝"}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>음성 안내 설정</Text>

              <View style={styles.voiceRowCompact}>
                <View style={styles.voiceItemCompact}>
                  <Text style={styles.voiceLabelCompact}>상태 멘트</Text>
                  <Switch
                    value={reportVoiceEnabled}
                    onValueChange={(value) =>
                      updateVoiceSettings({ reportVoiceEnabled: value })
                    }
                    trackColor={{ false: "#2A3552", true: "#7DD3FC" }}
                    thumbColor={reportVoiceEnabled ? "#FFFFFF" : "#D1D5DB"}
                  />
                </View>

                <View style={styles.voiceDividerVertical} />

                <View style={styles.voiceItemCompact}>
                  <Text style={styles.voiceLabelCompact}>코칭 멘트</Text>
                  <Switch
                    value={coachVoiceEnabled}
                    onValueChange={(value) =>
                      updateVoiceSettings({ coachVoiceEnabled: value })
                    }
                    trackColor={{ false: "#2A3552", true: "#7DD3FC" }}
                    thumbColor={coachVoiceEnabled ? "#FFFFFF" : "#D1D5DB"}
                  />
                </View>
              </View>
            </View>
          </>
        )}

        {session && (session.isRunning || session.isPaused) && (
          <View style={styles.card}>
            <Text style={styles.label}>목표 거리</Text>
            <Text style={styles.coachText}>
              {session.targetDistanceKm > 0
                ? `${session.targetDistanceKm.toFixed(2)}km 목표 러닝  ·  남은 거리 ${Math.max(
                    session.remainingDistanceKm ?? 0,
                    0
                  ).toFixed(2)}km`
                : "자유 러닝"}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>AI코치 분석</Text>
          <Text style={styles.coachText}>{coachAnalysisText}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>각 km 구간 스플릿</Text>

          {displaySession &&
          "splits" in displaySession &&
          displaySession.splits?.length ? (
            <>
              <View style={styles.splitHeaderRow}>
                <Text style={[styles.splitHeaderText, styles.splitKmCol]}>
                  구간
                </Text>
                <Text style={[styles.splitHeaderText, styles.splitPaceCol]}>
                  평균 페이스
                </Text>
                <Text style={[styles.splitHeaderText, styles.splitDeltaCol]}>
                  이전 대비
                </Text>
                <Text style={[styles.splitHeaderText, styles.splitElevCol]}>
                  고도 변화
                </Text>
              </View>

              {displaySession.splits.map((split: RunSplit, index: number) => {
                const prevSplit =
                  index > 0 ? displaySession.splits[index - 1] : null;
                const paceDeltaSec = prevSplit
                  ? Math.floor(split.avgPaceSec) - Math.floor(prevSplit.avgPaceSec)
                  : null;

                const elevationGainM = split.elevationGainM ?? 0;
                const elevationLossM = split.elevationLossM ?? 0;

                const gain = Math.max(0, Math.round(elevationGainM));
                const loss = Math.max(0, Math.round(elevationLossM));
                
                return (
                  <View
                    key={`split-${split.km}`}
                    style={[
                      styles.splitRow,
                      index === displaySession.splits.length - 1 && styles.lastSplitRow,
                    ]}
                  >

                    <Text style={[styles.splitCellText, styles.splitKmCol]}>
                      {split.km}km
                    </Text>

                    <Text
                      style={[
                        styles.splitCellText,
                        styles.splitPaceCol,
                        styles.splitPace,
                      ]}
                    >
                      {formatPace(split.avgPaceSec)}
                    </Text>

                    <Text
                      style={[
                        styles.splitCellText,
                        styles.splitDeltaCol,
                        getPaceDeltaTextStyle(paceDeltaSec),
                      ]}
                    >
                      {formatSignedPaceDeltaColon(paceDeltaSec)}
                    </Text>

                    <Text
                      style={[
                        styles.splitCellText,
                        styles.splitElevCol,
                        styles.splitElev,
                      ]}
                    >
                      <>
                        ▲{gain}m{"\n"}▼{loss}m
                      </>
                    </Text>
                  </View>
                );
              })}
            </>
          ) : (
            <Text style={styles.splitsEmptyText}>아직 생성된 스플릿이 없습니다.</Text>
          )}
        </View>

        <View>
          {!session?.isRunning && finishedSnapshot && (
            <Text style={{ color: "#7DD3FC", textAlign: "center" }}>
              러닝 데이터가 저장되었습니다.
            </Text>
          )}

          {!session?.isRunning ? (
            <View style={styles.buttonRow}>
              <Pressable
                style={[
                  styles.thirdBtnPrimary,
                  !startButtonReady && styles.disabledBtn,
                ]}
                onPress={handleStart}
                disabled={!startButtonReady}
              >
                <Text
                  style={[
                    styles.primaryText,
                    !startButtonReady && styles.disabledPrimaryText,
                  ]}
                >
                  러닝 시작
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.thirdBtn,
                  !lastFinishedRunId && styles.disabledTertiaryBtn,
                ]}
                onPress={handleViewResult}
                disabled={!lastFinishedRunId}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    !lastFinishedRunId && styles.disabledSecondaryText,
                  ]}
                >
                  결과 보기
                </Text>
              </Pressable>
            </View>
          ) : session.isPaused ? (
            <View style={styles.buttonRow}>
              <Pressable
                style={[
                  styles.thirdBtn,
                  resumePending && styles.disabledTertiaryBtn,
                ]}
                onPress={handleResume}
                disabled={resumePending}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    resumePending && styles.disabledSecondaryText,
                  ]}
                >
                  {resumePending ? "재개 중..." : "재개"}
                </Text>
              </Pressable>

              <Pressable style={styles.thirdBtnPrimary} onPress={handleFinish}>
                <Text style={styles.primaryText}>종료</Text>
              </Pressable>

              <Pressable
                style={[styles.thirdBtn, styles.disabledTertiaryBtn]}
                disabled
              >
                <Text
                  style={[styles.secondaryText, styles.disabledSecondaryText]}
                >
                  결과 보기
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              <Pressable style={styles.thirdBtn} onPress={handlePause}>
                <Text style={styles.secondaryText}>일시정지</Text>
              </Pressable>

              <Pressable style={styles.thirdBtnPrimary} onPress={handleFinish}>
                <Text style={styles.primaryText}>종료</Text>
              </Pressable>

              <Pressable
                style={[styles.thirdBtn, styles.disabledTertiaryBtn]}
                disabled
              >
                <Text
                  style={[styles.secondaryText, styles.disabledSecondaryText]}
                >
                  결과 보기
                </Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.backgroundNotice}>
            RUNHOLIC 앱을 닫아도 러닝 기록은 계속 실행됩니다.
            {"\n"}
            러닝을 완전히 종료하려면 앱 안에서 종료 버튼을 눌러주세요.
            {"\n"}
            {"\n"}
            출발 직후는 초기 계측 안정화 구간입니다.
            {"\n"}
            시계 이외의 계기판 표시가 잠시 지연될 수 있지만
            {"\n"}
            데이터는 정상 집계 중이므로 안심하세요.
            {"\n"}
            {"\n"}
            고도 변화는 오차 보정을 위해 일정 거리 이동 후 반영됩니다.
            {"\n"}
            건물이나 나무가 밀집한 구간에서는
            {"\n"}
            걷거나 저속 이동 시 고도 값에 오차가 발생할 수 있습니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}`;
}

function isUsableCurrentPace(sec: number | null | undefined) {
  return !!sec && Number.isFinite(sec) && sec > 0 && sec <= 3600;
}

function formatPace(sec: number) {
  if (!sec || !isFinite(sec)) return "--:--";

  const totalSec = Math.floor(sec);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSignedPaceDeltaColon(deltaSec: number | null) {
  if (deltaSec == null || !Number.isFinite(deltaSec)) return "-";

  const sign = deltaSec > 0 ? "+" : deltaSec < 0 ? "-" : "";
  const abs = Math.abs(deltaSec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);

  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

function getPaceDeltaTextStyle(deltaSec: number | null) {
  if (deltaSec == null || !Number.isFinite(deltaSec) || deltaSec === 0) {
    return styles.splitDeltaNeutral;
  }

  return deltaSec > 0 ? styles.splitDeltaSlower : styles.splitDeltaFaster;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },

  headerRow: {
    height: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerSideButton: { minWidth: 52 },
  backText: { color: "#DCE6FF", fontSize: 14, fontWeight: "700" },
  headerTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },

  map: {
    height: 220,
    borderRadius: 18,
    overflow: "hidden",
  },

  mapWrap: {
    position: "relative",
    marginBottom: 12,
  },

  mapStatusOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(180, 30, 30, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },

  mapStatusOverlayText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  mapLoadingCard: {
    height: 220,
    borderRadius: 18,
    backgroundColor: "#151C31",
    borderWidth: 1,
    borderColor: "#2A3555",
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: "center",
    marginBottom: 12,
  },

  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  halfCard: {
    width: "48%",
    backgroundColor: "#151C31",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    minHeight: 70,
  },

  card: {
    backgroundColor: "#151C31",
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 10,
  },

  label: { color: "#96A0B5", fontSize: 12, marginBottom: 4 },

  value: { color: "#FFF", fontSize: 20, fontWeight: "800" },

  coachText: { color: "#FFF", fontSize: 14, lineHeight: 20 },

  infoValueElevation: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 20,
  },

  elevationArrow: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },

  valueCenterWrap: {
    flex: 1,
    justifyContent: "center",
  },

  prepHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  prepHeaderTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  prepHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  prepHeaderSummary: {
    color: "#AAB3C5",
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  prepHeaderArrow: {
    opacity: 0.9,
  },

  splitHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#2A3555",
  },

  splitHeaderText: {
    color: "#96A0B5",
    fontSize: 12,
    fontWeight: "700",
  },

  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#2A3555",
  },

  splitKmCol: {
    flex: 1,
  },

  splitPaceCol: {
    flex: 1,
  },

  splitDeltaCol: {
    flex: 1,
  },

  splitElevCol: {
    flex: 1,
  },

  splitCellText: {
    fontSize: 14,
    color: "#DCE6FF",
    fontWeight: "800",
  },

  splitElev: {
    fontSize: 14,
    color: "#DCE6FF",
    fontWeight: "800",
  },

  splitPace: {
    fontSize: 14,
    color: "#DCE6FF",
    fontWeight: "800",
  },

  splitDeltaFaster: {
    fontSize: 14,
    color: "#22C55E",
    fontWeight: "800",
  },

  splitDeltaSlower: {
    fontSize: 14,
    color: "#FF6B6B",
    fontWeight: "800",
  },

  splitDeltaNeutral: {
    fontSize: 14,
    color: "#DCE6FF",
    fontWeight: "800",
  },

  splitsEmptyText: { 
    color: "#AAB3C5",
    fontSize: 14,
    fontWeight: "800",
  },

  lastSplitRow: {
    borderBottomWidth: 0,
  },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 10,
  },

  thirdBtn: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#26304D",
    borderWidth: 1,
    borderColor: "#2A3555",
    alignItems: "center",
    justifyContent: "center",
  },

  thirdBtnPrimary: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  primaryText: { color: "#111", fontSize: 16, fontWeight: "800" },

  disabledBtn: { opacity: 0.45 },

  disabledTertiaryBtn: {
    backgroundColor: "#1A2138",
    borderWidth: 1,
    borderColor: "#26304D",
  },

  disabledSecondaryText: {
    color: "#4B5563",
  },

  disabledPrimaryText: {
    color: "#6B7280",
  },

  goalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },

  goalCustomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },

  goalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#2A3555",
    borderRadius: 18,
    backgroundColor: "#26304D",
  },

  goalChipActive: {
    backgroundColor: "#FFFFFF",
  },

  goalChipText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },

  goalChipTextActive: {
    color: "#111111",
  },

  goalInput: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#0F1528",
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#2A3552",
  },

  goalHint: {
    marginTop: 10,
    color: "#AAB3C5",
    fontSize: 13,
    lineHeight: 18,
  },

  voiceRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  voiceItemCompact: {
    flex: 1,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  voiceLabelCompact: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  voiceDividerVertical: {
    width: 2,
    height: 20,
    backgroundColor: "#2A3555",
    marginHorizontal: 10,
  },

  backgroundNotice: {
    marginTop: 8,
    fontSize: 12.5,
    color: "#7F8AA3",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 10,
  },

  preMapStatusCard: {
    backgroundColor: "#151C31",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2A3555",
    paddingVertical: 3,
    paddingHorizontal: 10,
    marginBottom: 10,
  },

  preMapStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
  },

  preMapStatusText: {
    flex: 1,
    fontSize: 12,
    color: "#AAB3C5",
    lineHeight: 16,
  },

  retryBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#2A3550",
  },

  retryBtnText: {
    fontSize: 12,
    color: "#7DD3FC",
    fontWeight: "600",
  },

  mapLoadingPlaceholder: {
    color: "#AAB3C5",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
});