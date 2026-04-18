import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_KEY = "AIRUN_PROFILE";
const LAST_RUN_KEY = "AIRUN_LAST_RUN";
const RUN_HISTORY_KEY = "AIRUN_RUN_HISTORY";
const RUNNER_TYPE_HISTORY_KEY = "AIRUN_RUNNER_TYPE_HISTORY";

export type UserSex = "남성" | "여성";

export type UserProfile = {
  heightCm: number;
  weightKg: number;
  sex: UserSex;
  strideCm: number;
};

export type RunnerType =
  | "중립"
  | "케이던스형"
  | "스트라이드형"
  | "지속형"
  | "변속형";

export type RunnerTrait =
  | "미분류"
  | "초반과속형"
  | "후반약화형"
  | "안정유지형"
  | "변동형";

export type RoutePoint = {
  latitude: number;
  longitude: number;
  timestamp?: number;
  altitude?: number | null;
  accuracy?: number | null;
};

export type RunSplit = {
  km: number;
  avgPaceSec: number;
  cumulativeElevationGainM?: number;
  elevationDeltaM?: number;
  elevationGainM?: number;
  elevationLossM?: number;
};

export type RunData = {
  id: string;
  dateTimeText: string;
  startedAt: string;
  distance: number;
  pace: number;
  duration: number;
  calories: number;
  elevationGain: number;
  elevationLoss: number;
  cadence: number;
  aiCoachAnalysis: string;
  runnerType: RunnerType;
  runnerTrait?: RunnerTrait;
  route: RoutePoint[];
  routeSegments?: RoutePoint[][];
  splits: RunSplit[];

  // 누적 runnerType 분석용 요약 지표
  paceStdDev?: number;
  splitPaceRange?: number;
  paceStateChangeCount?: number;
  runnerTypeSource?: "neutral" | "history";
};

export async function saveProfile(profile: UserProfile) {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function loadProfile(): Promise<UserProfile | null> {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  return raw ? (JSON.parse(raw) as UserProfile) : null;
}

export async function saveLastRun(run: RunData) {
  await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
}

export async function loadLastRun(): Promise<RunData | null> {
  const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
  return raw ? (JSON.parse(raw) as RunData) : null;
}

export async function saveRunHistory(run: RunData) {
  const raw = await AsyncStorage.getItem(RUN_HISTORY_KEY);
  const history = raw ? (JSON.parse(raw) as RunData[]) : [];

  const deduped = history.filter((item) => item.id !== run.id);
  const updated = [run, ...deduped];

  await AsyncStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(updated));
}

export async function loadRunHistory(): Promise<RunData[]> {
  const raw = await AsyncStorage.getItem(RUN_HISTORY_KEY);
  return raw ? (JSON.parse(raw) as RunData[]) : [];
}

export async function loadRunById(id: string): Promise<RunData | null> {
  const history = await loadRunHistory();
  return history.find((item) => item.id === id) ?? null;
}

export async function deleteRunById(id: string) {
  const history = await loadRunHistory();
  const filtered = history.filter((item) => item.id !== id);
  await AsyncStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(filtered));

  const lastRun = await loadLastRun();
  if (lastRun?.id === id) {
    if (filtered.length > 0) {
      await saveLastRun(filtered[0]);
    } else {
      await AsyncStorage.removeItem(LAST_RUN_KEY);
    }
  }
}

export async function appendRunnerTypeHistory(type: RunnerType) {
  const raw = await AsyncStorage.getItem(RUNNER_TYPE_HISTORY_KEY);
  const history = raw ? (JSON.parse(raw) as RunnerType[]) : [];
  const updated = [type, ...history].slice(0, 30);
  await AsyncStorage.setItem(RUNNER_TYPE_HISTORY_KEY, JSON.stringify(updated));
}

export async function loadRunnerTypeHistory(): Promise<RunnerType[]> {
  const raw = await AsyncStorage.getItem(RUNNER_TYPE_HISTORY_KEY);
  return raw ? (JSON.parse(raw) as RunnerType[]) : [];
}

export function updateRunnerType(history: RunnerType[]): RunnerType {
  if (history.length === 0) return "중립";

  const counts = history.reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<RunnerType, number>);

  return (Object.keys(counts) as RunnerType[]).reduce((a, b) =>
    counts[a] >= counts[b] ? a : b
  );
}

export function formatRunDateTimeRange(startedAt: string, durationSec: number) {
  const start = new Date(startedAt);
  const end = new Date(start.getTime() + durationSec * 1000);

  const startDateText = formatDateWithDots(start);
  const endDateText = formatDateWithDots(end);
  const startTimeText = formatTimeWithSeconds(start);
  const endTimeText = formatTimeWithSeconds(end);

  const isSameDate =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (isSameDate) {
    return `${startDateText} ${startTimeText} ~ ${endTimeText}`;
  }

  return `${startDateText} ${startTimeText} ~ ${endDateText} ${endTimeText}`;
}

function formatDateWithDots(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd}.`;
}

function formatTimeWithSeconds(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${min}:${ss}`;
}

// 최근 N개 러닝 가져오기 (최신순) 
export async function loadRecentRuns(limit: number = 3): Promise<RunData[]> {
  const runs = await loadRunHistory();
  return runs
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .slice(0, limit);
}

export function deriveRunnerTypeFromHistory(runs: RunData[]): RunnerType {
  const usable = runs.filter(
    (run) =>
      (run.distance ?? 0) >= 2 &&
      Number.isFinite(run.paceStdDev) &&
      Number.isFinite(run.splitPaceRange)
  );

  if (usable.length < 3) {
    return "중립";
  }

  const recent = usable
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .slice(0, 10);

  const avgStdDev =
    recent.reduce((sum, run) => sum + (run.paceStdDev ?? 0), 0) / recent.length;

  const avgRange =
    recent.reduce((sum, run) => sum + (run.splitPaceRange ?? 0), 0) /
    recent.length;

  const avgChanges =
    recent.reduce(
      (sum, run) => sum + (run.paceStateChangeCount ?? 0),
      0
    ) / recent.length;

  if (avgStdDev < 18 && avgRange < 35 && avgChanges < 2) {
    return "지속형";
  }

  return "변속형";
}

export async function getRunnerTypeFromHistory(): Promise<RunnerType> {
  const history = await loadRunHistory();
  return deriveRunnerTypeFromHistory(history);
}

export function deriveRunnerTraitFromHistory(runs: RunData[]): RunnerTrait {
  const usable = runs.filter((run) => (run.distance ?? 0) >= 2);

  if (usable.length < 3) {
    return "미분류";
  }

  const recent = usable
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .slice(0, 10);

  const counts = recent.reduce((acc, run) => {
    const trait = run.runnerTrait ?? "미분류";
    acc[trait] = (acc[trait] || 0) + 1;
    return acc;
  }, {} as Record<RunnerTrait, number>);

  const candidates: RunnerTrait[] = [
    "초반과속형",
    "후반약화형",
    "안정유지형",
    "변동형",
    "미분류",
  ];

  return candidates.reduce((best, current) =>
    (counts[current] || 0) > (counts[best] || 0) ? current : best
  , "미분류");
}

export async function getRunnerTraitFromHistory(): Promise<RunnerTrait> {
  const history = await loadRunHistory();
  return deriveRunnerTraitFromHistory(history);
}