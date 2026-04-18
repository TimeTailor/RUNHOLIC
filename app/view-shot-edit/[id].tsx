import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import ViewShot from "react-native-view-shot";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  formatRunDateTimeRange,
  loadRunById,
  type RunData,
} from "../../utils/storage";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

type TextPosition = "top" | "bottom";

const cadencePool = [
  "리듬 유지가 인상적인 러닝",
  "템포가 살아 있었던 러닝",
  "호흡과 리듬이 잘 맞아 떨어진 러닝",
  "흐름이 끊기지 않은 안정적인 러닝",
  "리듬 컨트롤이 돋보인 러닝",
  "일정한 박자가 유지된 러닝",
  "템포가 무너지지 않은 러닝",
  "발걸음이 가볍게 이어진 러닝",
];

const stridePool = [
  "추진감이 살아 있는 러닝",
  "보폭이 안정적으로 이어진 러닝",
  "힘 있게 밀어낸 러닝",
  "전진 감각이 살아 있는 러닝",
  "지면을 강하게 밀어낸 러닝",
  "폭발력 있는 보폭이 인상적인 러닝",
  "한 걸음 한 걸음 힘이 실린 러닝",
  "전진력이 돋보인 러닝",
];

const variationPool = [
  "구간 전환이 돋보인 러닝",
  "리듬 변화가 살아 있는 러닝",
  "페이스 조절이 인상적인 러닝",
  "전환 타이밍이 좋았던 러닝",
  "변속 흐름이 자연스러운 러닝",
  "속도 변화가 효과적이었던 러닝",
  "구간별 집중력이 살아난 러닝",
  "리듬 변화가 매끄러운 러닝",
];

const finishKickPool = [
  "후반 집중력이 돋보인 러닝",
  "마무리 페이스가 살아난 러닝",
  "끝까지 힘을 끌어올린 러닝",
  "라스트 구간이 강했던 러닝",
  "후반 승부가 인상적인 러닝",
  "마지막까지 밀어붙인 러닝",
  "후반 상승이 돋보인 러닝",
];

const stablePool = [
  "끝까지 리듬을 지켜낸 러닝",
  "흐름이 무너지지 않은 러닝",
  "안정적으로 이어간 러닝",
  "일정한 페이스가 유지된 러닝",
  "균형 잡힌 러닝",
  "흔들림 없이 이어간 러닝",
];

const longRunPool = [
  "끈기 있게 완성한 장거리 러닝",
  "지구력이 빛난 러닝",
  "끝까지 버텨낸 러닝",
  "긴 거리도 흔들리지 않은 러닝",
  "완주 집중력이 돋보인 러닝",
  "체력을 끝까지 유지한 러닝",
];

const midRunPool = [
  "집중력 있게 이어간 러닝",
  "균형 잡힌 페이스의 러닝",
  "안정적으로 완성한 러닝",
  "리듬이 잘 유지된 러닝",
  "꾸준히 밀어붙인 러닝",
];

const fastPacePool = [
  "경쾌한 페이스가 돋보인 러닝",
  "속도감이 살아 있는 러닝",
  "빠른 템포가 인상적인 러닝",
  "경쾌하게 이어진 러닝",
  "스피드가 살아난 러닝",
];

const highelevationPool = [
  "강한 업힐을 견딘 러닝",
  "험한 고도를 이겨낸 러닝",
  "거친 지형을 돌파한 러닝",
  "높은 고도를 넘어선 러닝",
  "등산같은 언덕을 극복한 러닝",
];

const elevationPool = [
  "상승 구간을 견딘 러닝",
  "오르막을 이겨낸 러닝",
  "고도를 극복한 러닝",
  "지형을 이겨낸 러닝",
  "업힐 구간이 인상적인 러닝",
];

const defaultPool = [
  "오늘도 멈추지 않은 러닝",
  "한 걸음씩 쌓아올린 러닝",
  "꾸준함이 만든 기록",
  "멈추지 않고 이어간 러닝",
  "오늘도 나를 넘은 러닝",
  "조용히 완성한 러닝",
  "흐름을 이어간 하루의 기록",
];

function pick(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildCoachHeadline(run: RunData) {
  const analysis = run.aiCoachAnalysis?.trim() ?? "";
  const distance = run.distance ?? 0;
  const pace = run.pace ?? 0;
  const cadence = run.cadence ?? 0;
  const elevation = run.elevationGain ?? 0;
  const runnerType = run.runnerType ?? "";

  if (analysis.includes("후반 구간에서 페이스를 크게 끌어올렸습니다")) {
    return pick(finishKickPool);
  }

  if (analysis.includes("후반 구간에서 페이스를 잘 끌어올렸습니다")) {
    return pick(finishKickPool);
  }

  if (analysis.includes("후반 구간에서도 흐름이 크게 흔들리지 않았습니다")) {
    return pick(stablePool);
  }

  if (analysis.includes("케이던스")) {
    return pick(cadencePool);
  }

  if (analysis.includes("보폭")) {
    return pick(stridePool);
  }

  if (analysis.includes("변속")) {
      return pick(variationPool);
  }

  if (runnerType === "변속형") {
    return pick(variationPool);
  }

  if (runnerType === "케이던스형") {
    return pick(cadencePool);
  }

  if (runnerType === "스트라이드형") {
    return pick(stridePool);
  }

  if (distance >= 10) {
    return pick(longRunPool);
  }

  if (distance >= 5) {
    return pick(midRunPool);
  }

  if (pace > 0 && pace < 360) {
    return pick(fastPacePool);
  }

  if (cadence >= 170) {
    return pick(cadencePool);
  }

  if (elevation >= 80) {
    return pick(highelevationPool);
  }

  if (elevation >= 30) {
    return pick(elevationPool);
  }

  return pick(defaultPool);
}

export default function ViewShotEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: windowWidth } = useWindowDimensions();

  const [run, setRun] = useState<RunData | null>(null);
  const [backgroundUri, setBackgroundUri] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [textPosition, setTextPosition] = useState<TextPosition>("bottom");
  const [darkOverlay, setDarkOverlay] = useState(false);

  const shotRef = useRef<ViewShot | null>(null);

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    loadRunById(id).then((data) => {
      if (!mounted) return;
      setRun(data);
    });

    return () => {
      mounted = false;
    };
  }, [id]);

  const dateText = useMemo(() => {
    if (!run) return "";
    return formatRunDateTimeRange(run.startedAt, run.duration);
  }, [run]);

  const coachHeadline = useMemo(() => {
    if (!run) return "";
    return buildCoachHeadline(run);
  }, [run]);

  const previewWidth = Math.max(windowWidth - 32, 1);
  const previewScale = previewWidth / CANVAS_W;
  const previewHeight = CANVAS_H * previewScale;

  const pickBackgroundImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "권한 필요",
          "배경 사진을 선택하려면 사진 접근 권한이 필요합니다.",
          [
            { text: "취소", style: "cancel" },
            {
              text: "설정으로 이동",
              onPress: async () => {
                try {
                  await Linking.openSettings();
                } catch (error) {
                  console.log("open settings error:", error);
                }
              },
            },
          ]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets?.length) {
        setBackgroundUri(result.assets[0].uri);
      }
    } catch (error) {
      console.log("pickBackgroundImage error:", error);
      Alert.alert("오류", "사진을 불러오는 중 문제가 발생했습니다.");
    }
  };

  const captureImage = async () => {
    if (!shotRef.current || !run || !backgroundUri) return null;

    try {
      const rawUri = await shotRef.current.capture?.({
        result: "tmpfile",
        format: "png",
        quality: 1,
      });

      if (!rawUri) {
        throw new Error("VIEWSHOT_CAPTURE_FAILED");
      }

      const now = new Date();
      const timestamp = now
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");

      const distance = run.distance.toFixed(2);
      const newPath =
        `${FileSystem.cacheDirectory}RUNHOLIC_CUSTOM_${distance}km_${timestamp}.png`;

      await FileSystem.copyAsync({
        from: rawUri,
        to: newPath,
      });

      const info = await FileSystem.getInfoAsync(newPath);

      if (!info.exists) {
        throw new Error("COPIED_FILE_NOT_FOUND");
      }

      return newPath;
    } catch (error) {
      console.log("captureImage error:", error);
      throw error;
    }
  };

  const ensureMediaPermission = async () => {
    const permission = await MediaLibrary.requestPermissionsAsync(false, [
      "photo",
    ]);

    if (permission.granted) return true;

    Alert.alert(
      "권한 필요",
      "이미지를 저장하려면 사진 접근 권한이 필요합니다. 설정에서 권한을 허용해주세요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "설정으로 이동",
          onPress: async () => {
            try {
              await Linking.openSettings();
            } catch (error) {
              console.log("open settings error:", error);
            }
          },
        },
      ]
    );

    return false;
  };

  const handleSaveImage = () => {
    Alert.alert(
      "이미지 저장",
      "꾸민 인증 이미지를 휴대폰 갤러리에 저장합니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "저장",
          onPress: async () => {
            if (!run || !backgroundUri || saving || sharing) return;

            try {
              setSaving(true);

              const granted = await ensureMediaPermission();
              if (!granted) return;

              const uri = await captureImage();

              if (!uri) {
                Alert.alert("저장 실패", "이미지를 캡처하지 못했습니다.");
                return;
              }

              const albumName = "RUNHOLIC_RecordShots";
              const asset = await MediaLibrary.createAssetAsync(uri);
              const album = await MediaLibrary.getAlbumAsync(albumName);

              if (album == null) {
                await MediaLibrary.createAlbumAsync(albumName, asset, false);
              } else {
                await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
              }

              Alert.alert("저장 완료", "갤러리에 저장되었습니다.");
            } catch (error: any) {
              console.log("save error:", error);
              Alert.alert(
                "오류",
                `이미지 저장 중 문제 발생\n${String(error?.message ?? error)}`
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleShareImage = async () => {
    if (!run || !backgroundUri || saving || sharing) return;

    try {
      setSharing(true);

      const uri = await captureImage();

      if (!uri) {
        Alert.alert("공유 실패", "이미지 생성에 실패했습니다.");
        return;
      }

      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        Alert.alert("공유 불가", "이 기기에서는 공유 기능을 사용할 수 없습니다.");
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "러닝 인증 이미지 공유",
        UTI: "public.png",
      });
    } catch (error: any) {
      console.log("share error:", error);
      Alert.alert(
        "오류",
        `이미지 공유 중 문제 발생\n${String(error?.message ?? error)}`
      );
    } finally {
      setSharing(false);
    }
  };

  if (!run) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.headerSideButton}
          >
            <Text style={styles.backText}>← 뒤로</Text>
          </Pressable>
          <View style={styles.headerSideButton} />
        </View>

        <View style={styles.hiddenCaptureHost} pointerEvents="none">
          <ViewShot
            ref={shotRef}
            options={{
              width: CANVAS_W,
              height: CANVAS_H,
              format: "png",
              quality: 1,
            }}
            style={styles.captureCanvas}
            collapsable={false}
          >
            <StaticShotCanvas
              run={run}
              dateText={dateText}
              coachHeadline={coachHeadline}
              backgroundUri={backgroundUri}
              textPosition={textPosition}
              darkOverlay={darkOverlay}
            />
          </ViewShot>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View
            style={{
              width: previewWidth,
              height: previewHeight,
              alignSelf: "center",
              overflow: "hidden",
              borderRadius: 18,
            }}
          >
            <View
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: [{ scale: previewScale }],
                transformOrigin: "top left" as any,
              }}
            >
              <StaticShotCanvas
                run={run}
                dateText={dateText}
                coachHeadline={coachHeadline}
                backgroundUri={backgroundUri}
                textPosition={textPosition}
                darkOverlay={darkOverlay}
              />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>배경 사진</Text>

            <Pressable style={styles.pickButton} onPress={pickBackgroundImage}>
              <Text style={styles.pickButtonText}>
                {backgroundUri ? "사진 다시 선택" : "사진 선택"}
              </Text>
            </Pressable>

            <Text style={styles.helperText}>
              배경 사진을 선택하면 자동으로 적용됩니다.
              {"\n"}
              배경 사진은 9:16 비율의 세로 사진을 권장합니다.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>텍스트 위치</Text>

            <View style={styles.segmentRow}>
              <Pressable
                style={[
                  styles.segmentButton,
                  textPosition === "top" && styles.segmentButtonActive,
                ]}
                onPress={() => setTextPosition("top")}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    textPosition === "top" && styles.segmentButtonTextActive,
                  ]}
                >
                  상단
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.segmentButton,
                  textPosition === "bottom" && styles.segmentButtonActive,
                ]}
                onPress={() => setTextPosition("bottom")}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    textPosition === "bottom" && styles.segmentButtonTextActive,
                  ]}
                >
                  하단
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.cardTitle, { marginTop: 12 }]}>배경 밝기</Text>

            <View style={styles.segmentRow}>
              <Pressable
                style={[
                  styles.segmentButton,
                  darkOverlay && styles.segmentButtonActive,
                ]}
                onPress={() => setDarkOverlay(true)}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    darkOverlay && styles.segmentButtonTextActive,
                  ]}
                >
                  어둡게
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.segmentButton,
                  !darkOverlay && styles.segmentButtonActive,
                ]}
                onPress={() => setDarkOverlay(false)}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    !darkOverlay && styles.segmentButtonTextActive,
                  ]}
                >
                  밝게
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <Pressable
              style={[
                styles.secondaryButton,
                (!backgroundUri || saving || sharing) && styles.buttonDisabled,
              ]}
              onPress={handleSaveImage}
              disabled={!backgroundUri || saving || sharing}
            >
              <Text style={styles.secondaryButtonText}>
                {saving ? "저장 중..." : "이미지 저장하기"}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.primaryButton,
                (!backgroundUri || saving || sharing) && styles.buttonDisabled,
              ]}
              onPress={handleShareImage}
              disabled={!backgroundUri || saving || sharing}
            >
              <Text style={styles.primaryButtonText}>
                {sharing ? "공유 준비 중..." : "SNS로 공유하기"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function StaticShotCanvas({
  run,
  dateText,
  coachHeadline,
  backgroundUri,
  textPosition,
  darkOverlay,
}: {
  run: RunData;
  dateText: string;
  coachHeadline: string;
  backgroundUri: string | null;
  textPosition: TextPosition;
  darkOverlay: boolean;
}) {
  return (
    <View style={canvas.wrap}>
      {backgroundUri ? (
        <Image
          source={{ uri: backgroundUri }}
          style={canvas.backgroundImageCover}
          resizeMode="cover"
        />
      ) : (
        <View style={canvas.emptyBackground}>
          <Text style={canvas.emptyBackgroundText}>배경 사진을 선택하세요</Text>
        </View>
      )}

      <View
        style={[
          canvas.overlay,
          {
            backgroundColor: darkOverlay
              ? "rgba(0,0,0,0.34)"
              : "rgba(0,0,0,0.08)",
          },
        ]}
      />

      <View
        style={[
          canvas.contentWrap,
          textPosition === "top"
            ? canvas.contentWrapTop
            : canvas.contentWrapBottom,
        ]}
      >
        <View style={canvas.card}>
          <Text style={canvas.dateText}>{dateText}</Text>

          <Text style={canvas.coachHeadline}>{coachHeadline}</Text>

          <View style={canvas.row}>
            <Item
              label="총 거리"
              value={`${run.distance.toFixed(2)} km`}
            />
            <Item label="총 시간" value={formatDuration(run.duration)} />
          </View>

          <View style={canvas.row}>
            <Item
              label="평균 페이스"
              value={`${formatPace(run.pace)}/km`}
            />
            <Item
              label="평균 케이던스" value={`${Math.round(run.cadence)} spm`} />
          </View>

          <View style={canvas.rowLast}>
            <Item
              label="누적 고도 변화"
              value={
                <Text style={canvas.valueElevation} numberOfLines={1}>
                  <Text style={canvas.elevationArrow}>▲</Text>
                  {Math.round(run.elevationGain)}
                  m{" "}
                  <Text style={canvas.elevationArrow}>▼</Text>
                  {Math.round(run.elevationLoss)}
                  m
                </Text>
              }
            />
            <Item label="칼로리" value={`${Math.round(run.calories)} kcal`} />
          </View>
        </View>

        <View style={canvas.logoWrap}>
          <Image
            source={require("../../assets/images/logo_pictureshot.png")}
            style={canvas.logo}
          />
        </View>
      </View>
    </View>
  );
}

function Item({
  label,
  value,
  style,
}: {
  label: string;
  value: React.ReactNode;
  style?: any;
}) {
  return (
    <View style={[canvas.item, style]}>
      <Text style={canvas.label}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={canvas.value}>{value}</Text>
      ) : (
        value
      )}
    </View>
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

  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
  },

  headerRow: {
    height: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 0,
  },

  headerSideButton: {
    minWidth: 48,
  },

  backText: {
    color: "#DCE6FF",
    fontSize: 14,
    fontWeight: "700",
  },

  scrollContent: {
    paddingBottom: 24,
  },

  hiddenCaptureHost: {
    position: "absolute",
    left: -3000,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    opacity: 1,
  },

  captureCanvas: {
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: "#0B1020",
  },

  card: {
    backgroundColor: "#151C31",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginTop: 12,
  },

  cardTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 6,
  },

  helperText: {
    color: "#AAB3C5",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
  },

  pickButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1A2540",
    alignItems: "center",
    justifyContent: "center",
  },

  pickButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  segmentRow: {
    flexDirection: "row",
    gap: 10,
  },

  segmentButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#10182B",
    borderWidth: 1,
    borderColor: "#2A3555",
    alignItems: "center",
    justifyContent: "center",
  },

  segmentButtonActive: {
    backgroundColor: "#FFFFFF",
  },

  segmentButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  segmentButtonTextActive: {
    color: "#111111",
  },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
  },

  primaryButton: {
    flex: 1,
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

  secondaryButton: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#10182B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#2A3555",
  },

  secondaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  buttonDisabled: {
    opacity: 0.6,
  },
});

const canvas = StyleSheet.create({
  wrap: {
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: "#0B1020",
    overflow: "hidden",
  },

  backgroundImageCover: {
    ...StyleSheet.absoluteFillObject,
  },

  emptyBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#121A31",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyBackgroundText: {
    color: "#AAB3C5",
    fontSize: 44,
    fontWeight: "600",
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
  },

  contentWrap: {
    position: "absolute",
    left: 56,
    right: 56,
  },

  contentWrapTop: {
    top: 92,
  },

  contentWrapBottom: {
    bottom: 92,
  },

  dateText: {
    color: "#DCE6FF",
    fontSize: 42,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 20,

    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  coachHeadline: {
    color: "#FFFFFF",
    fontSize: 48,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 60,
    marginBottom: 28,

    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  card: {
    width: "92%",
    alignSelf: "center",
    backgroundColor: "rgba(10, 14, 26, 0.36)",
    borderRadius: 34,
    paddingHorizontal: 40,
    paddingVertical: 42,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.14)",
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 44,
    paddingLeft: 68,
    paddingRight: 4,
  },

  rowLast: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 68,
    paddingRight: 4,
  },

  item: {
    width: "48%",
    minHeight: 130,
    justifyContent: "center",
  },

  label: {
    color: "#C6D2EE",
    fontSize: 36,
    fontWeight: "600",
    marginBottom: 14,

    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  value: {
    color: "#FFFFFF",
    fontSize: 60,
    fontWeight: "800",
    lineHeight: 68,
    textAlignVertical: "center",

    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  valueElevation: {
    color: "#FFFFFF",
    fontSize: 46,
    fontWeight: "800",
    lineHeight: 68,
    textAlignVertical: "center",
    transform: [{ translateY: -2 }],
  },

  elevationArrow: {
    color: "#FFFFFF",
    fontSize: 40,
    fontWeight: "800",
    transform: [{ translateY: -2 }],
  },

  logoWrap: {
    alignSelf: "center",
    marginTop: 28,
  },

  logo: {
    width: 320,
    height: 56,
    resizeMode: "contain",
    opacity: 0.9,

    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,

    elevation: 12,
  },
});