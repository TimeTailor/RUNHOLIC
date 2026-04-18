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
import MapView, { Polyline } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import ViewShot from "react-native-view-shot";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import {
  formatRunDateTimeRange,
  loadRunById,
  RunData,
} from "../../utils/storage";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

export default function ViewShotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: windowWidth } = useWindowDimensions();

  const [run, setRun] = useState<RunData | null>(null);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [captureMapReady, setCaptureMapReady] = useState(false);

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

      const latDelta = Math.max((maxLat - minLat) * 1.3, 0.0012);
      const lngDelta = Math.max((maxLng - minLng) * 1.3, 0.0012);

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

  const dateText = useMemo(() => {
    if (!run) return "";
    return formatRunDateTimeRange(run.startedAt, run.duration);
  }, [run]);

  useEffect(() => {
    setCaptureMapReady(false);
  }, [
    id,
    mapRegion.latitude,
    mapRegion.longitude,
    mapRegion.latitudeDelta,
    mapRegion.longitudeDelta,
  ]);

  const previewWidth = Math.max(windowWidth - 32, 1) * 0.85;
  const previewScale = previewWidth / CANVAS_W;
  const previewHeight = CANVAS_H * previewScale;

  const captureImage = async () => {
    if (!shotRef.current || !run) return null;

    try {
      if (!captureMapReady) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const rawUri = await shotRef.current.capture?.({
        result: "tmpfile",
        format: "png",
        quality: 1,
      });

      if (!rawUri) {
        console.log("captureImage: rawUri 없음");
        throw new Error("VIEWSHOT_CAPTURE_FAILED");
      }

      console.log("captureImage rawUri:", rawUri);

      const now = new Date();
      const timestamp = now
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");

      const distance = run.distance.toFixed(2);

      const newPath =
        `${FileSystem.cacheDirectory}RUNHOLIC_${distance}km_${timestamp}.png`;

      console.log("captureImage newPath:", newPath);

      await FileSystem.copyAsync({
        from: rawUri,
        to: newPath,
      });

      const info = await FileSystem.getInfoAsync(newPath);
      console.log("captureImage copied file info:", info);

      if (!info.exists) {
        throw new Error("COPIED_FILE_NOT_FOUND");
      }

      return newPath;
    } catch (e) {
      console.log("captureImage error:", e);
      throw e;
    }
  };

  const ensureMediaPermission = async () => {
    const permission = await MediaLibrary.requestPermissionsAsync(
      false,
      ["photo"]
    );

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
              console.error(error);
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
      "러닝 인증 이미지를 휴대폰 갤러리에 저장합니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "저장",
          onPress: async () => {
            if (!run || saving || sharing) return;

            try {
              setSaving(true);

              const granted = await ensureMediaPermission();
              console.log("save: permission =", granted);

              if (!granted) return;

              const uri = await captureImage();
              console.log("save: capture uri =", uri);

              if (!uri) {
                Alert.alert("저장 실패", "이미지를 캡처하지 못했습니다.");
                return;
              }

              const ALBUM_NAME = "RUNHOLIC_RecordShots";

              console.log("save: createAsset start");
              const asset = await MediaLibrary.createAssetAsync(uri);
              console.log("save: createAsset ok", asset);

              console.log("save: getAlbum start");
              const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
              console.log("save: getAlbum ok", album);

              if (album == null) {
                console.log("save: createAlbum start");
                await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
                console.log("save: createAlbum ok");
              } else {
                console.log("save: addAssetsToAlbum start");
                await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
                console.log("save: addAssetsToAlbum ok");
              }

              Alert.alert("저장 완료", "갤러리에 저장되었습니다.");
            } catch (error: any) {
              console.log("save pipeline error:", error);
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
    if (!run || saving || sharing) return;

    try {
      setSharing(true);

      const uri = await captureImage();
      console.log("share: capture uri =", uri);

      if (!uri) {
        Alert.alert("공유 실패", "이미지 생성에 실패했습니다.");
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      console.log("share: canShare =", canShare);

      if (!canShare) {
        Alert.alert("공유 불가", "이 기기에서는 공유 기능을 사용할 수 없습니다.");
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "러닝 인증 이미지 공유",
        UTI: "public.png",
      });

      console.log("share: shareAsync ok");
    } catch (error: any) {
      console.log("share pipeline error:", error);
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
            <ShotCanvas
              run={run}
              dateText={dateText}
              mapRegion={mapRegion}
              isCapture
              onCaptureMapReady={() => setCaptureMapReady(true)}
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
              pointerEvents="none"
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: [{ scale: previewScale }],
                transformOrigin: "top left" as any,
              }}
            >
              <ShotCanvas
                run={run}
                dateText={dateText}
                mapRegion={mapRegion}
              />
            </View>
          </View>

          <View style={styles.buttonRow}>
            <Pressable
              style={[
                styles.secondaryButton,
                (saving || sharing) && styles.buttonDisabled,
              ]}
              onPress={handleSaveImage}
              disabled={saving || sharing}
            >
              <Text style={styles.secondaryButtonText}>
                {saving ? "저장 중..." : "이미지 저장하기"}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.primaryButton,
                (saving || sharing) && styles.buttonDisabled,
              ]}
              onPress={handleShareImage}
              disabled={saving || sharing}
            >
              <Text style={styles.primaryButtonText}>
                {sharing ? "공유 준비 중..." : "SNS로 공유하기"}
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => router.push(`/view-shot-edit/${id}`)}
          >
            <Text style={styles.editButtonText}>
              사진 배경으로 인증샷 꾸미기
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function ShotCanvas({
  run,
  dateText,
  mapRegion,
  isCapture = false,
  onCaptureMapReady,
}: {
  run: RunData;
  dateText: string;
  mapRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  isCapture?: boolean;
  onCaptureMapReady?: () => void;
}) {
  const routeSegments =
    run.routeSegments ?? (run.route.length ? [run.route] : []);
  const flatRoute = routeSegments.flat();
  const hasRoute = flatRoute.length >= 1;
  return (
    <View style={canvas.wrap}>
      <Text style={canvas.dateText}>{dateText}</Text>

      <View style={canvas.mapWrap}>
        {!hasRoute ? (
          <Image
            source={require("../../assets/images/no_route.png")}
            style={canvas.map}
            resizeMode="cover"
          />
        ) : (
          <MapView
            style={canvas.map}
            region={mapRegion}
            onMapReady={() => {
              if (isCapture) {
                onCaptureMapReady?.();
              }
            }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            {routeSegments.map((segment, index) =>
              segment.length >= 2 ? (
                <Polyline
                  key={`shot-segment-${index}`}
                  coordinates={segment}
                  strokeWidth={8}
                  strokeColor="#4DA6FF"
                />
              ) : null
            )}
          </MapView>
        )}

        <View pointerEvents="none" style={canvas.mapFrame} />
      </View>

      <View style={canvas.card}>
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

      <Image
        source={require("../../assets/images/logo_viewshot.png")}
        style={canvas.logo}
      />
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

  editButton: {
    width: "100%",
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1A2540",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },

  editButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});

const canvas = StyleSheet.create({
  wrap: {
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: "#0B1020",
    paddingTop: 110,
    paddingBottom: 40,
    paddingHorizontal: 44,
  },

  dateText: {
    color: "#A8B3CF",
    fontSize: 44,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2,
    marginTop: 10,
    marginBottom: 40,
  },

  mapWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: 42,
    overflow: "hidden",
    marginBottom: 42,
  },

  map: {
    width: "100%",
    height: "100%",
  },

  mapFrame: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 42,
    borderWidth: 5,
    borderColor: "#1A2540",
  },

  card: {
    backgroundColor: "#151C31",
    borderRadius: 34,
    paddingHorizontal: 40,
    paddingVertical: 48,
    borderWidth: 2,
    borderColor: "#2A3555",
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
    minHeight: 150,
    justifyContent: "center",
  },

  label: {
    color: "#9FB0D0",
    fontSize: 42,
    fontWeight: "600",
    marginBottom: 18,
  },

  value: {
    color: "#FFFFFF",
    fontSize: 70,
    fontWeight: "800",
    lineHeight: 78,
    textAlignVertical: "center",
  },

  valueElevation: {
    color: "#FFFFFF",
    fontSize: 52,
    fontWeight: "800",
    lineHeight: 78,
    textAlignVertical: "center",
    transform: [{ translateY: -2 }],
  },

  elevationArrow: {
    color: "#FFFFFF",
    fontSize: 45,
    fontWeight: "800",
    transform: [{ translateY: -2 }],
  },

  logo: {
    width: 360,
    height: 60,
    resizeMode: "contain",
    alignSelf: "center",
    opacity: 0.6,
    marginTop: 42,
  },
});