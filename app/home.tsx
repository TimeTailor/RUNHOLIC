import React, { useCallback, useMemo, useState } from "react";
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
import { router, useFocusEffect } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  formatRunDateTimeRange,
  loadLastRun,
  loadProfile,
  RunData,
  UserProfile,
} from "../utils/storage";

const EMPTY_RUN: RunData = {
  id: "empty",
  dateTimeText: "----. --. --. --:--:-- ~ --:--:--",
  startedAt: "",
  distance: 0,
  pace: 0,
  duration: 0,
  calories: 0,
  elevationGain: 0,
  elevationLoss: 0,
  cadence: 0,
  aiCoachAnalysis: "아직 AI코치 분석 데이터가 없습니다.",
  runnerType: "지속형",
  route: [],
  splits: [],
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [lastRun, setLastRun] = useState<RunData | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadLastRun().then(setLastRun);
      loadProfile().then(setProfile);
    }, [])
  );

  const displayRun = lastRun ?? EMPTY_RUN;

  const routeSegments =
    displayRun.routeSegments ?? (displayRun.route.length ? [displayRun.route] : []);
  const flatRoute = routeSegments.flat();
  const hasAnyRun = !!lastRun;
  const hasRoute = flatRoute.length >= 1;

  const mapRegion = useMemo(() => {
    if (flatRoute.length > 0) {
      return {
        latitude: flatRoute[0].latitude,
        longitude: flatRoute[0].longitude,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      };
    }

    return {
      latitude: 37.5665,
      longitude: 126.978,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }, [displayRun]);

  const dateTimeRangeText = displayRun.startedAt
    ? formatRunDateTimeRange(displayRun.startedAt, displayRun.duration)
    : displayRun.dateTimeText;

  const handleGoRunning = () => {
    if (!profile) {
      Alert.alert(
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

    router.push("/running");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View>
            <Image
              source={require("../assets/images/logo_home.png")}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <Pressable onPress={() => router.push("/profile-setup")}>
            <Text style={styles.editText}>프로필 입력/수정</Text>
          </Pressable>
        </View>

        {profile ? (
          <View style={styles.profileCard}>
            <Text style={styles.profileText}>
              {profile.sex} · {profile.heightCm}cm · {profile.weightKg}kg · 보폭{" "}
              {profile.strideCm}cm
            </Text>
          </View>
        ) : (
          <Pressable
            style={styles.profileCard}
            onPress={() => router.push("/profile-setup")}
          >
            <Text style={styles.profileText}>
              러닝 시작 전 사용자 프로필 입력이 필요합니다.
              {"\n"}
              눌러서 입력하세요.
            </Text>
          </Pressable>
        )}

        <View style={styles.reportCard}>
          <Text style={styles.sectionTitle}>최근 마지막 러닝</Text>

          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>년월일시</Text>
            <Text style={styles.metaValue}>{dateTimeRangeText}</Text>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>총 거리</Text>
              <Text style={styles.infoValue}>
                {displayRun.distance.toFixed(2)} km
              </Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>총 시간</Text>
              <Text style={styles.infoValue}>
                {formatDuration(displayRun.duration)}
              </Text>
            </View>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>평균 페이스</Text>
              <Text style={styles.infoValue}>
                {formatPace(displayRun.pace)}/km
              </Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>평균 케이던스</Text>
              <Text style={styles.infoValue}>
                {Math.round(displayRun.cadence)} spm
              </Text>
            </View>
          </View>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>누적 고도 변화</Text>

              <View style={styles.valueCenterWrap}>
                <Text style={styles.infoValueElevation} numberOfLines={1}>
                  <Text style={styles.elevationArrow}>▲</Text>
                  {Math.round(displayRun.elevationGain)}
                  m{" "}
                  <Text style={styles.elevationArrow}>▼</Text>
                  {Math.round(displayRun.elevationLoss)}
                  m
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>칼로리</Text>
              <Text style={styles.infoValue}>
                {Math.round(displayRun.calories)} kcal
              </Text>
            </View>
          </View>

          <View style={styles.analysisCard}>
            <Text style={styles.analysisLabel}>AI코치 분석</Text>
            <Text style={styles.analysisText}>{displayRun.aiCoachAnalysis}</Text>
          </View>

          <View style={styles.map}>
            {!hasAnyRun ? (
              <Image
                source={require("../assets/images/empty_run.png")}
                style={styles.mapFill}
                resizeMode="cover"
              />
            ) : !hasRoute ? (
              <Image
                source={require("../assets/images/no_route.png")}
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
                      key={`home-segment-${index}`}
                      coordinates={segment}
                      strokeWidth={4}
                      strokeColor="#4DA6FF"
                    />
                  ) : null
                )}
              </MapView>
            )}
          </View>
        </View>

        <Pressable style={styles.primaryButton} onPress={handleGoRunning}>
          <Text style={styles.primaryButtonText}>러닝 화면</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push("/history")}
        >
          <Text style={styles.secondaryButtonText}>기록 보기</Text>
        </Pressable>
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

  content: {
    paddingHorizontal: 20,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },

  logo: {
    width: 130,
    height: 21,
    marginTop: 6,
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },

  editText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 0,
  },

  profileCard: {
    backgroundColor: "#151C31",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 12,
  },

  profileText: {
    color: "#D8DEEA",
    fontSize: 13,
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
    backgroundColor: "#10182B",
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
    fontSize: 15,
    fontWeight: "700",
  },

  infoValueElevation: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 15,
    transform: [{ translateY: -2 }],
  },

  elevationArrow: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
    transform: [{ translateY: -2 }],
  },

  valueCenterWrap: {
    flex: 1,
    justifyContent: "center",
  },

  map: {
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 6,
  },

  mapFill: {
    width: "100%",
    height: "100%",
  },

  primaryButton: {
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  primaryButtonText: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "800",
  },

  secondaryButton: {
    height: 56,
    borderRadius: 28,
    backgroundColor: "#10182B",
    borderWidth: 1,
    borderColor: "#2A3555",
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  analysisCard: {
    backgroundColor: "#101728",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginTop: 2,
    marginBottom: 4,
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
});