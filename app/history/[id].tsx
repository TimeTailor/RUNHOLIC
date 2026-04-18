import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Polyline } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  deleteRunById,
  formatRunDateTimeRange,
  loadRunById,
  RunData,
} from "../../utils/storage";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { bannerUnitId } from "../../utils/adManager";

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    loadRunById(id).then((data) => {
      if (!mounted) return;
      setRun(data);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [id]);

  const mapRegion = useMemo(() => {
    const routeSegments =
      run?.routeSegments ?? (run?.route?.length ? [run.route] : []);
    const flatRoute = routeSegments.flat();

    if (flatRoute.length > 0) {
      const lats = flatRoute.map((p) => p.latitude);
      const lngs = flatRoute.map((p) => p.longitude);

      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;

      const latDelta = Math.max((maxLat - minLat) * 1.8, 0.0025);
      const lngDelta = Math.max((maxLng - minLng) * 1.8, 0.0025);

      return {
        latitude: centerLat,
        longitude: centerLng,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      };
    }

    return {
      latitude: 37.5665,
      longitude: 126.978,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }, [run]);

  const handleDelete = () => {
    if (!run?.id) return;

    Alert.alert("기록 삭제", "이 러닝 기록을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          await deleteRunById(run.id);
          router.back();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>데이터를 불러오는 중...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!run) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>러닝 기록을 찾을 수 없습니다.</Text>
          <Pressable style={styles.backButtonAlone} onPress={() => router.back()}>
            <Text style={styles.backButtonAloneText}>뒤로 가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const routeSegments =
    run.routeSegments ?? (run.route.length ? [run.route] : []);
  const flatRoute = routeSegments.flat();
  const hasRoute = flatRoute.length >= 1;

  const dateTimeRangeText = formatRunDateTimeRange(run.startedAt, run.duration);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: insets.bottom + 30,
          paddingHorizontal: 20,
        }}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.headerSideButton}>
            <Text style={styles.backText}>← 뒤로</Text>
          </Pressable>

          <Text style={styles.headerTitle}>러닝 리포트</Text>

          <Pressable onPress={handleDelete} style={styles.headerSideButton}>
            <Text style={styles.deleteText}>삭제</Text>
          </Pressable>
        </View>

        <View style={styles.map}>
          {!hasRoute ? (
            <Image
              source={require("../../assets/images/no_route.png")}
              style={styles.mapFill}
              resizeMode="cover"
            />
          ) : (
            <MapView
              style={styles.mapFill}
              region={mapRegion}
              scrollEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              zoomEnabled={false}
            >
              {routeSegments.map((segment, index) =>
                segment.length >= 2 ? (
                  <Polyline
                    key={`detail-segment-${index}`}
                    coordinates={segment}
                    strokeWidth={4}
                    strokeColor="#4DA6FF"
                  />
                ) : null
              )}
            </MapView>
          )}
        </View>

        <View style={styles.reportCard}>
          <Text style={styles.sectionTitle}>러닝 상세 데이터</Text>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>년월일시</Text>
            <Text style={styles.metaValue}>{dateTimeRangeText}</Text>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>총 거리</Text>
              <Text style={styles.infoValue}>
                {run.distance.toFixed(2)} km
              </Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>총 시간</Text>
              <Text style={styles.infoValue}>
                {formatDuration(run.duration)}
              </Text>
            </View>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>평균 페이스</Text>
              <Text style={styles.infoValue}>
                {formatPace(run.pace)}/km
              </Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>평균 케이던스</Text>
              <Text style={styles.infoValue}>
                {Math.round(run.cadence)} spm
              </Text>
            </View>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>누적 고도 변화</Text>

              <View style={styles.valueCenterWrap}>
                <Text style={styles.infoValueElevation} numberOfLines={1}>
                  <Text style={styles.elevationArrow}>▲</Text>
                  {Math.round(run.elevationGain)}
                  m{" "}
                  <Text style={styles.elevationArrow}>▼</Text>
                  {Math.round(run.elevationLoss)}
                  m
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>칼로리</Text>
              <Text style={styles.infoValue}>
                {Math.round(run.calories)} kcal
              </Text>
            </View>
          </View>

          <View style={styles.analysisCard}>
            <Text style={styles.analysisLabel}>AI코치 분석</Text>
            <Text style={styles.analysisText}>{run.aiCoachAnalysis}</Text>
          </View>
        </View>

        <View style={styles.splitsCard}>
          <Text style={styles.sectionTitle}>각 km 구간 스플릿</Text>

          {run.splits.length > 0 ? (
            <>
              <View style={styles.splitHeaderRow}>
                <Text style={[styles.splitHeaderText, styles.splitKmCol]}>구간</Text>
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

              {run.splits.map((split, index) => {
                const prevSplit = index > 0 ? run.splits[index - 1] : null;
                const paceDeltaSec =
                  prevSplit ? split.avgPaceSec - prevSplit.avgPaceSec : null;

                const elevationGainM = split.elevationGainM ?? 0;
                const elevationLossM = split.elevationLossM ?? 0;

                const gain = Math.max(0, Math.round(elevationGainM));
                const loss = Math.max(0, Math.round(elevationLossM));
                const isFlat = gain === 0 && loss === 0;

                return (
                  <View
                    key={`detail-split-${split.km}-${index}`}
                    style={[
                      styles.splitRow,
                      index === run.splits.length - 1 && styles.lastSplitRow,
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
                      {formatSignedPaceDelta(paceDeltaSec)}
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
            <Text style={styles.splitsEmptyText}>
              아직 러닝 스플릿 데이터가 없습니다.
            </Text>
          )}
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={() =>
            router.push({
              pathname: "/view-shot/[id]",
              params: { id },
            })
          }
        >
          <Text style={styles.primaryButtonText}>인증 이미지 만들기</Text>
        </Pressable>
      </ScrollView>

        <View style={[styles.bannerFixed, { paddingBottom: insets.bottom }]}>
          <BannerAd
            unitId={bannerUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          />
        </View>
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

function formatPace(secPerKm: number) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "--:--";
  const totalSec = Math.floor(secPerKm);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatSignedPaceDelta(deltaSec: number | null) {
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

  return deltaSec > 0
    ? styles.splitDeltaSlower
    : styles.splitDeltaFaster;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0B1020",
  },

  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#0B1020",
  },
  loadingText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  backButtonAlone: {
    marginTop: 16,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonAloneText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },

  headerRow: {
    height: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerSideButton: {
    minWidth: 48,
  },
  backText: {
    color: "#DCE6FF",
    fontSize: 14,
    fontWeight: "700",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  deleteText: {
    color: "#FFB4B4",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "right",
  },

  map: {
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 12,
  },

  mapFill: {
    width: "100%",
    height: "100%",
  },

  reportCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10,
  },

  metaBlock: {
    marginBottom: 10,
  },
  metaLabel: {
    color: "#96A0B5",
    fontSize: 13,
    marginBottom: 4,
  },
  metaValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },

  infoGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  infoCard: {
    width: "48%",
    backgroundColor: "#101728",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    minHeight: 68,
  },

  infoLabel: {
    color: "#96A0B5",
    fontSize: 12,
    marginBottom: 4,
  },

  infoValue: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  infoValueElevation: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 18,
  },

  elevationArrow: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },

  valueCenterWrap: {
    flex: 1,
    justifyContent: "center",
  },

  analysisCard: {
    backgroundColor: "#101728",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginTop: 2,
  },

  analysisLabel: {
    color: "#96A0B5",
    fontSize: 12,
    marginBottom: 4,
  },

  analysisText: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 20,
  },

  splitsCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 18,
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

  primaryButton: {
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButtonText: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "800",
  },

  bannerFixed: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    alignItems: "center",
    backgroundColor: "transparent",
  },
});