import React, { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  formatRunDateTimeRange,
  loadRunHistory,
  RunData,
} from "../utils/storage";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { bannerUnitId } from "../utils/adManager";

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<RunData[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadRunHistory().then(setHistory);
    }, [])
  );

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
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backText}>← 뒤로</Text>
          </Pressable>

          <Text style={styles.headerTitle}>러닝 기록</Text>

          <View style={{ width: 40 }} />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>전체 기록</Text>
          <Text style={styles.summaryValue}>{history.length}회</Text>
          <Text style={styles.summaryDesc}>
            각 기록을 누르면 해당 러닝 리포트를 상세하게 볼 수 있습니다
          </Text>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 저장된 러닝 기록이 없습니다</Text>
            <Text style={styles.emptyDesc}>
              러닝을 완료하면 이곳에 기록이 누적됩니다
            </Text>
          </View>
        ) : (
          history.map((item) => (
            <Pressable
              key={item.id}
              style={styles.historyCard}
              onPress={() =>
                router.push({
                  pathname: "/history/[id]",
                  params: { id: item.id },
                })
              }
            >

              <Text style={styles.dateText}>
                {formatRunDateTimeRange(item.startedAt, item.duration)}
              </Text>

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>총 거리</Text>
                  <Text style={styles.metricValue}>
                    {item.distance.toFixed(2)} km
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>총 시간</Text>
                  <Text style={styles.metricValue}>
                    {formatDuration(item.duration)}
                  </Text>
                </View>
              </View>

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>평균 페이스</Text>
                  <Text style={styles.metricValue}>
                    {formatPace(item.pace)}/km
                  </Text>
                </View>

                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>평균 케이던스</Text>
                  <Text style={styles.metricValue}>
                    {Math.round(item.cadence)} spm
                  </Text>
                </View>
              </View>

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>누적 고도 변화</Text>

                  <View style={styles.valueCenterWrap}>
                    <Text style={styles.metricValueElevation} numberOfLines={1}>
                      <Text style={styles.elevationArrow}>▲</Text>
                      {Math.round(item.elevationGain)}
                      m{" "}
                      <Text style={styles.elevationArrow}>▼</Text>
                      {Math.round(item.elevationLoss)}
                      m
                    </Text>
                  </View>
                </View>

                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>칼로리</Text>
                  <Text style={styles.metricValue}>
                    {Math.round(item.calories)} kcal
                  </Text>
                </View>
              </View>

              <View style={styles.bottomRow}>
                <View />
                <Text style={styles.detailText}>리포트 보기</Text>
              </View>
            </Pressable>
          ))
        )}
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0B1020",
  },

  headerRow: {
    height: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
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

  summaryCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 12,
  },

  summaryLabel: {
    color: "#96A0B5",
    fontSize: 13,
    marginBottom: 4,
  },

  summaryValue: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
  },

  summaryDesc: {
    color: "#D8DEEA",
    fontSize: 13,
    lineHeight: 20,
  },

  emptyCard: {
    backgroundColor: "#151C31",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
  },

  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },

  emptyDesc: {
    color: "#AAB3C5",
    fontSize: 14,
    lineHeight: 20,
  },

  historyCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 12,
  },

  dateText: {
    color: "#DCE6FF",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 22,
    marginBottom: 10,
  },

  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  metricBox: {
    width: "48%",
    backgroundColor: "#101728",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    minHeight: 68,
  },

  metricLabel: {
    color: "#96A0B5",
    fontSize: 12,
    marginBottom: 4,
  },

  metricValue: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },

  metricValueElevation: {
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

  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },

  bottomMeta: {
    color: "#AAB3C5",
    fontSize: 13,
  },
  detailText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },

  bannerFixed: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    alignItems: "center",
    backgroundColor: "transparent",
  },
});