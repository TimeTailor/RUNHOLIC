import React, { useEffect, useRef, useState } from "react";
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
} from "react-native";
import { EventEmitter, requireNativeModule } from "expo-modules-core";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as Battery from "expo-battery";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useNavigation } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
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

const IDLE_MAP_DELTA = 0.01;      // 시작 전: 반경 1km 정도
const EARLY_RUN_MAP_DELTA = 0.003; // 시작 직후: 반경 300m 정도

const MIN_FIT_ROUTE_LAT_SPAN = 0.0015;
const MIN_FIT_ROUTE_LNG_SPAN = 0.0015;

const RUN_MAP_EDGE_PADDING = {
  top: 80,
  right: 80,
  bottom: 80,
  left: 80,
};

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

export default function RunningScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const mapRef = useRef<MapView | null>(null);
  const allowExitRef = useRef(false);
  const gpsTimeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const foregroundIntroShownRef = useRef(false);
  const backgroundIntroShownRef = useRef(false);
  const batteryPopupShownRef = useRef(false);
  const permissionFlowRunningRef = useRef(false);
  const modalLockRef = useRef(false);
  const lastGpsNoticeSessionIdRef = useRef<string | null>(null);

  const [session, setSession] = useState<NativeSessionPayload | null>(null);
  const [finishedSnapshot, setFinishedSnapshot] = useState<RunData | null>(null);
  const [currentLocation, setCurrentLocation] = useState<RoutePoint | null>(null);

  const [permissionReady, setPermissionReady] = useState(false);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);
  const [notificationReady, setNotificationReady] = useState(
    Platform.OS !== "android"
  );
  const [locationStatusText, setLocationStatusText] = useState("권한 확인 중");
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
  const [pendingFinish, setPendingFinish] = useState(false);

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
    setSession(next);

    if (!next) return;

    if (next.lastPoint) {
      setCurrentLocation(next.lastPoint);
      if (!next.autoPausedByGpsLoss) {
        setGpsTimeout(false);
      }
    }

    if (
      !next.isPaused &&
      next.currentPaceSec > 0 &&
      Number.isFinite(next.currentPaceSec)
    ) {
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

    await loadCurrentLocation();
  };

  useEffect(() => {
    loadVoiceSettings();
    refreshSession();
    bootstrapPermissionFlow();
    loadInterstitial();

    const emitter = getNativeEmitter();
    const sub = emitter?.addListener?.("onSessionUpdate", (payload: any) => {
      const normalized = normalizeNativeSession(payload);
      if (!normalized) return;
      applySession(normalized);
    });

    return () => {
      if (gpsTimeoutTimerRef.current) {
        clearTimeout(gpsTimeoutTimerRef.current);
      }

      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void bootstrapPermissionFlow(true);
      void refreshBatteryOptimizationStatus();

      (async () => {
        const active = await refreshSession();

        if (active?.isRunning) {
          await restoreRunningState();
        } else {
          await resetIdleRunningScreen();
        }
      })();
    });

    return unsubscribe;
  }, [navigation]);

  useFocusEffect(
    React.useCallback(() => {
      let mounted = true;

      (async () => {
        const active = await refreshSession();
        if (!mounted) return;

        if (!active?.isRunning) {
          await resetIdleRunningScreen();
        }
      })();

      return () => {
        mounted = false;
      };
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      async (nextState: AppStateStatus) => {
        if (nextState !== "active") return;

        await refreshBatteryOptimizationStatus();
        await restoreRunningState();
      }
    );

    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;

    const activeRouteSegments = buildDisplaySegments(session?.routeSegments ?? []);
    const activeFlatRoute = activeRouteSegments.flat();

    const finishedRouteSegments = buildDisplaySegments(
      finishedSnapshot?.routeSegments ??
        (finishedSnapshot?.route?.length ? [finishedSnapshot.route] : [])
    );
    const finishedFlatRoute = finishedRouteSegments.flat();

    // 러닝 중이면 현재 세션 기준으로 처리
    if (session?.isRunning && !session.isPaused) {
      if (activeFlatRoute.length < 2) {
        mapRef.current.animateToRegion(
          {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            latitudeDelta: EARLY_RUN_MAP_DELTA,
            longitudeDelta: EARLY_RUN_MAP_DELTA,
          },
          250
        );
        return;
      }

      const lats = activeFlatRoute.map((p) => p.latitude);
      const lngs = activeFlatRoute.map((p) => p.longitude);

      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      const latSpan = maxLat - minLat;
      const lngSpan = maxLng - minLng;

      // 초반엔 전체 fit 하지 않고 300m 정도 축척 유지
      if (
        latSpan < MIN_FIT_ROUTE_LAT_SPAN &&
        lngSpan < MIN_FIT_ROUTE_LNG_SPAN
      ) {
        mapRef.current.animateToRegion(
          {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            latitudeDelta: EARLY_RUN_MAP_DELTA,
            longitudeDelta: EARLY_RUN_MAP_DELTA,
          },
          250
        );
        return;
      }

      mapRef.current.fitToCoordinates(activeFlatRoute, {
        edgePadding: RUN_MAP_EDGE_PADDING,
        animated: true,
      });
      return;
    }

    // 종료 후 결과 스냅샷이 있으면 그것도 전체 경로로 맞춤
    if (finishedFlatRoute.length >= 2) {
      mapRef.current.fitToCoordinates(finishedFlatRoute, {
        edgePadding: RUN_MAP_EDGE_PADDING,
        animated: true,
      });
      return;
    }

    // 시작 전: 현재 위치 기준 1km 정도 축척
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
    await refreshSession();

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

  const openAppSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.log("Open settings error:", error);
    }
  };

  const showPermissionSettingsAlert = async ({
    title,
    message,
  }: {
    title: string;
    message: string;
  }) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const shown = showLockedAlert(title, message, [
        { text: "취소", style: "cancel" },
        {
          text: "설정으로 이동",
          onPress: () => {
            openAppSettings();
          },
        },
      ]);

      if (shown) return;

      await wait(250);
    }
  };

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

  const requestNotificationPermission = async () => {
    const settings = await Notifications.getPermissionsAsync();
    const alreadyGranted =
      settings.granted ||
      settings.ios?.status ===
        Notifications.IosAuthorizationStatus.AUTHORIZED;

    if (alreadyGranted) {
      setNotificationReady(true);
      return true;
    }

    const shouldRequest = await askLockedAlert(
      "알림 권한 안내",
      "백그라운드 러닝 추적 상태를 상태표시줄에 표시하려면 알림 권한이 필요합니다.",
      "권한 허용"
    );

    if (!shouldRequest) {
      setNotificationReady(false);
      return false;
    }

    const requested = await Notifications.requestPermissionsAsync();
    const granted =
      requested.granted ||
      requested.ios?.status ===
        Notifications.IosAuthorizationStatus.AUTHORIZED;

    setNotificationReady(granted);

    if (!granted) {
      await showPermissionSettingsAlert({
        title: "알림 권한 필요",
        message:
          "백그라운드 러닝 추적 상태를 표시하려면 알림 권한이 필요합니다. 설정에서 알림 권한을 허용해주세요.",
      });
      return false;
    }

    return true;
  };

  const requestBackgroundPermission = async () => {
    setLocationStatusText("백그라운드 위치 권한 요청 중");

    const bg = await Location.requestBackgroundPermissionsAsync();
    const granted = bg.status === "granted";

    setBackgroundReady(granted);

    if (!granted) {
      await showPermissionSettingsAlert({
        title: "항상 허용 권장",
        message:
          "화면이 꺼져도 러닝 기록을 계속하려면 백그라운드 위치 권한이 필요합니다. 설정에서 '항상 허용'으로 바꿔주세요.",
      });
      return false;
    }

    setLocationStatusText("백그라운드 위치 권한 확인 완료");
    return true;
  };

  const requestForegroundPermission = async () => {
    setLocationStatusText("전경 위치 권한 요청 중");

    const fg = await Location.requestForegroundPermissionsAsync();
    const granted = fg.status === "granted";

    setPermissionReady(granted);

    if (!granted) {
      setGpsReady(false);
      setLocationStatusText("전경 위치 권한이 필요합니다");

      await showPermissionSettingsAlert({
        title: "위치 권한 필요",
        message:
          "러닝 거리, 페이스, 지도 기록을 위해 위치 권한이 필요합니다. 설정에서 위치 권한을 허용해주세요.",
      });
      return false;
    }

    await loadCurrentLocation();
    return true;
  };

  const promptBatteryOptimizationSetup = () => {
    if (Platform.OS !== "android") return;

    showLockedAlert(
      "백그라운드 실행 권장 설정",
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

  const maybePromptBatteryOptimization = async () => {
    if (Platform.OS !== "android") return;

    try {
      const cachedDisabled =
        (await AsyncStorage.getItem(BATTERY_OPT_DISABLED_KEY)) === "1";

      if (cachedDisabled) {
        setNeedsBatteryOptimization(false);
        return;
      }

      const enabled = await Battery.isBatteryOptimizationEnabledAsync();

      if (!enabled) {
        setNeedsBatteryOptimization(false);
        await AsyncStorage.setItem(BATTERY_OPT_DISABLED_KEY, "1");
        return;
      }

      setNeedsBatteryOptimization(true);

      if (!batteryPopupShownRef.current) {
        batteryPopupShownRef.current = true;
        promptBatteryOptimizationSetup();
      }
    } catch (error) {
      console.log("Battery optimization prompt check error:", error);
      setNeedsBatteryOptimization(true);

      if (!batteryPopupShownRef.current) {
        batteryPopupShownRef.current = true;
        promptBatteryOptimizationSetup();
      }
    }
  };

  const runPermissionSequence = async () => {
    if (permissionFlowRunningRef.current) return;
    permissionFlowRunningRef.current = true;

    try {
      setLocationStatusText("위치 권한 상태 확인 중");

      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();

      const fgGranted = fg.status === "granted";
      const bgGranted = bg.status === "granted";

      setPermissionReady(fgGranted);
      setBackgroundReady(bgGranted);

      let finalFgGranted = fgGranted;

      if (!fgGranted) {
        if (!foregroundIntroShownRef.current) {
          foregroundIntroShownRef.current = true;

          const shouldRequestFg = await askLockedAlert(
            "위치 권한 안내",
            "러닝 기록, 지도 표시, 거리 및 페이스 계산을 위해 위치 권한이 필요합니다.",
            "권한 허용"
          );

          if (!shouldRequestFg) {
            setGpsReady(false);
            setGpsTimeout(false);
            setLocationStatusText("전경 위치 권한이 필요합니다");
            return;
          }
        }

        finalFgGranted = await requestForegroundPermission();
        if (!finalFgGranted) return;

        await wait(900);
      } else {
        await loadCurrentLocation();
      }

      await requestNotificationPermission();

      const bgAfter = await Location.getBackgroundPermissionsAsync();
      const bgAfterGranted = bgAfter.status === "granted";
      setBackgroundReady(bgAfterGranted);

      if (!bgAfterGranted) {
        if (!backgroundIntroShownRef.current) {
          backgroundIntroShownRef.current = true;

          const shouldRequestBg = await askLockedAlert(
            "항상 허용 권장",
            "화면이 꺼져도 러닝 기록과 음성 안내를 안정적으로 유지하려면 백그라운드 위치 권한을 '항상 허용'하는 것이 좋습니다.",
            "권한 허용"
          );

          if (shouldRequestBg) {
            await requestBackgroundPermission();
            await wait(900);
          }
        }
      }

      setTimeout(() => {
        void maybePromptBatteryOptimization();
      }, 1000);

      await refreshBatteryOptimizationStatus();
      await loadCurrentLocation();

      const bgFinal = await Location.getBackgroundPermissionsAsync();
      setBackgroundReady(bgFinal.status === "granted");

      if (Platform.OS === "android") {
        const settings = await Notifications.getPermissionsAsync();
        const granted =
          settings.granted ||
          settings.ios?.status ===
            Notifications.IosAuthorizationStatus.AUTHORIZED;
        setNotificationReady(granted);
      }
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
        setLocationStatusText("전경 위치 권한이 필요합니다");
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

  const resolvedTargetDistanceKm =
    targetMode === "free"
      ? null
      : targetMode === "custom"
      ? (() => {
          const parsed = Number(customTargetText);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        })()
      : Number(targetMode);

  const targetSummaryText = resolvedTargetDistanceKm
    ? `${resolvedTargetDistanceKm}km`
    : "자유 러닝";

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

  const handleStart = async () => {
    if (!RunholicForeground?.startRun) {
      showLockedAlert(
        "러닝 시작 실패",
        "네이티브 모듈이 아직 준비되지 않았습니다. 앱을 다시 열어주세요.",
        [{ text: "확인" }]
      );
      return;
    }

    if (!permissionReady) {
      await runPermissionSequence();
      return;
    }

    if (!gpsReady) {
      showLockedAlert(
        "GPS 준비 중",
        "GPS 신호가 안정되면 러닝을 시작할 수 있습니다.",
        [{ text: "확인" }]
      );
      return;
    }

    if (!notificationReady) {
      showLockedAlert(
        "알림 권한 필요",
        "백그라운드 러닝 추적 상태를 표시하려면 알림 권한을 먼저 허용해주세요.",
        [
          { text: "취소", style: "cancel" },
          {
            text: "권한 허용",
            onPress: async () => {
              await requestNotificationPermission();
            },
          },
        ]
      );
      return;
    }

    if (needsBatteryOptimization) {
      showLockedAlert(
        "배터리 최적화 예외 필요",
        "화면이 꺼져도 러닝 기록과 음성 안내가 안정적으로 유지되도록, RUNHOLIC 앱의 배터리 사용 제한을 '제한 없음'으로 설정해야 러닝을 시작할 수 있습니다.",
        [
          { text: "취소", style: "cancel" },
          {
            text: "설정 열기",
            onPress: async () => {
              promptBatteryOptimizationSetup();
            },
          },
        ]
      );
      return;
    }

    if (!currentLocation) {
      showLockedAlert("위치 확인 중", "현재 위치를 먼저 잡아 주세요.", [
        { text: "확인" },
      ]);
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

      showLockedAlert(
        "러닝 시작 실패",
        `${error?.code ?? "NO_CODE"}\n${error?.message ?? String(error)}`,
        [{ text: "확인" }]
      );
      return;
    }

    setLastFinishedRunId(null);
    setFinishedSnapshot(null);
    setPrepExpanded(false);
    setLastValidPace(0);

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

  const handleFinish = async () => {
    if (pendingFinish) return;

    try {
      setPendingFinish(true);
      await RunholicForeground.stopRun();
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

      if (finalRun.route.length) {
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

  const handleViewResult = () => {
    if (!lastFinishedRunId) return;

    showInterstitial(() => {
      router.replace({
        pathname: "/result",
        params: { id: lastFinishedRunId },
      });
    });
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
    gpsReady &&
    notificationReady &&
    !needsBatteryOptimization &&
    !session?.isRunning &&
    (targetMode !== "custom" || resolvedTargetDistanceKm !== null);

  const displaySession =
    session?.isRunning || session?.isPaused ? session : finishedSnapshot;

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

  const shouldShowLivePace =
    !!session?.isRunning && !session?.isPaused;

  const isResumeGrace =
    !!session?.isRunning &&
    !session?.isPaused &&
    !!session?.resumedAt &&
    Date.now() - session.resumedAt < 3000;

  const displayCurrentPace =
    session?.isPaused
      ? 0
      : session?.currentPaceSec &&
        session.currentPaceSec > 0 &&
        isFinite(session.currentPaceSec)
      ? session.currentPaceSec
      : finishedSnapshot?.pace && finishedSnapshot.pace > 0
      ? finishedSnapshot.pace
      : lastValidPace;

  const renderMap = () => {
    if (!currentLocation) {
      return (
        <View style={styles.mapLoadingCard}>
          <Text style={styles.mapLoadingTitle}>러닝 준비 상태</Text>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>위치 권한</Text>
            <Text style={styles.statusValue}>
              {permissionReady ? "확인 완료" : "확인 중"}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>백그라운드 권한</Text>
            <Text style={styles.statusValue}>
              {backgroundReady ? "확인 완료" : "확인 중 또는 미허용"}
            </Text>
          </View>

          {Platform.OS === "android" && (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>알림 권한</Text>
              <Text style={styles.statusValue}>
                {notificationReady ? "확인 완료" : "권한 필요"}
              </Text>
            </View>
          )}

          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>GPS 상태</Text>
            <Text style={styles.statusValue}>
              {gpsReady ? "준비 완료" : gpsTimeout ? "신호 약함" : "위치 확인 중"}
            </Text>
          </View>

          <Text style={styles.mapLoadingDesc}>{locationStatusText}</Text>

          {!permissionReady && (
            <Pressable
              style={styles.secondaryActionBtn}
              onPress={runPermissionSequence}
            >
              <Text style={styles.secondaryActionText}>권한 순차 설정 시작</Text>
            </Pressable>
          )}

          {permissionReady && Platform.OS === "android" && !notificationReady && (
            <Pressable
              style={styles.secondaryActionBtn}
              onPress={requestNotificationPermission}
            >
              <Text style={styles.secondaryActionText}>알림 권한 허용</Text>
            </Pressable>
          )}
        </View>
      );
    }

    const liveSession =
      session && (session.isRunning || session.isPaused) ? session : null;

    const routeSegments =
      liveSession?.routeSegments ??
      (finishedSnapshot?.routeSegments ??
        (finishedSnapshot?.route?.length ? [finishedSnapshot.route] : []));

    const displayRouteSegments = buildDisplaySegments(routeSegments);
    const flatRoute = displayRouteSegments.flat();

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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: insets.bottom,
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
            <Text style={styles.label}>시간</Text>
            <Text style={styles.value}>{formatDuration(displayDuration)}</Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.halfCard}>
            <Text style={styles.label}>현재 페이스</Text>
            <Text style={styles.value}>
              {formatPace(
                isResumeGrace ? 0 : displayCurrentPace,
                !!session?.isRunning && !session?.isPaused && !isResumeGrace
              )}
              /km
            </Text>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.label}>평균 페이스</Text>
            <Text style={styles.value}>
              {formatPace(
                displayAvgPace,
                !!session?.isRunning
              )}
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
            onPress={() => setPrepExpanded((prev) => !prev)}
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
                    하프 21.1
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
                    풀 42.2
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
                    placeholder="예: 7.5"
                    placeholderTextColor="#7F8AA3"
                    keyboardType="decimal-pad"
                    style={styles.goalInput}
                  />
                )}
              </View>

              <Text style={styles.goalHint}>
                {resolvedTargetDistanceKm
                  ? `현재 목표 거리: ${resolvedTargetDistanceKm}km`
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

            {Platform.OS === "android" && needsBatteryOptimization && (
              <View style={styles.card}>
                <Text style={styles.label}>백그라운드 절전 예외</Text>
                <Text style={styles.goalHint}>
                  배터리 최적화 예외 설정이 완료되어야
                  {"\n"}
                  러닝을 시작할 수 있습니다.
                  {"\n"}
                  화면이 꺼져도 추적과 음성 안내가 안정적으로 유지되도록
                  {"\n"}
                  RUNHOLIC 앱을 '제한 없음'으로 설정해 주세요.
                </Text>
                <Pressable
                  style={styles.secondaryActionBtn}
                  onPress={promptBatteryOptimizationSetup}
                >
                  <Text style={styles.secondaryActionText}>설정 열기</Text>
                </Pressable>
              </View>
            )}

            {Platform.OS === "android" && !notificationReady && (
              <View style={styles.card}>
                <Text style={styles.label}>상태표시줄 알림 권한</Text>
                <Text style={styles.goalHint}>
                  RUNHOLIC 앱을 닫아도 러닝 데이터 추적은 계속됩니다. 러닝을
                  완전히 종료하려면 앱 안에서 종료 버튼을 눌러주세요.
                </Text>
                <Pressable
                  style={styles.secondaryActionBtn}
                  onPress={requestNotificationPermission}
                >
                  <Text style={styles.secondaryActionText}>알림 권한 허용</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {displaySession && (
          <View style={styles.card}>
            <Text style={styles.label}>목표 거리</Text>
            <Text style={styles.coachText}>
              {"targetDistanceKm" in displaySession &&
              displaySession.targetDistanceKm > 0
                ? `${displaySession.targetDistanceKm.toFixed(1)}km 목표 러닝`
                : "자유 러닝"}
              {"targetDistanceKm" in displaySession &&
              displaySession.targetDistanceKm > 0
                ? `  ·  남은 거리 ${Math.max(
                    (displaySession.remainingDistanceKm ?? 0),
                    0
                  ).toFixed(2)}km`
                : ""}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>AI코치 분석</Text>
          <Text style={styles.coachText}>
            {"aiCoachAnalysis" in (displaySession ?? {})
              ? (displaySession as any).aiCoachAnalysis ??
                "러닝을 시작하면 AI코치 분석이 표시됩니다."
              : finishedSnapshot?.aiCoachAnalysis ??
                "러닝을 시작하면 AI코치 분석이 표시됩니다."}
          </Text>
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
                  ? split.avgPaceSec - prevSplit.avgPaceSec
                  : null;

                const elevationGainM = split.elevationGainM ?? 0;
                const elevationLossM = split.elevationLossM ?? 0;

                const gain = Math.max(0, Math.round(elevationGainM));
                const loss = Math.max(0, Math.round(elevationLossM));
                const isFlat = gain === 0 && loss === 0;

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
                      {isFlat ? "—" : <>▲{gain}m{" "}▼{loss}m</>}
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
                  !canStartRun && styles.disabledBtn,
                ]}
                onPress={handleStart}
                disabled={!canStartRun}
              >
                <Text
                  style={[
                    styles.primaryText,
                    !canStartRun && styles.disabledPrimaryText,
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

function formatPace(sec: number, isRunning: boolean) {
  if (!sec || !isFinite(sec)) {
    return isRunning ? "00:00" : "--:--";
  }
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
  mapLoadingTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  mapLoadingDesc: {
    color: "#D8DEEA",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },

  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  statusLabel: { color: "#AAB3C5", fontSize: 13 },
  statusValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

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
    color: "#4DA6FF",
    fontWeight: "800",
  },

  splitDeltaSlower: {
    fontSize: 14,
    color: "#FF6B6B",
    fontWeight: "800",
  },

  splitDeltaNeutral: {
    fontSize: 14,
    color: "#AAB3C5",
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

  secondaryActionBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#26304D",
    borderWidth: 1,
    borderColor: "#2A3555",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  backgroundNotice: {
    marginTop: 8,
    fontSize: 12.5,
    color: "#7F8AA3",
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 10,
  },
});