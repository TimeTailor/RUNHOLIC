import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { loadProfile, saveProfile, UserSex } from "../utils/storage";

export default function ProfileSetupScreen() {
  const insets = useSafeAreaInsets();

  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [strideCm, setStrideCm] = useState("");
  const [sex, setSex] = useState<UserSex>("남성");

  useEffect(() => {
    loadProfile().then((profile) => {
      if (!profile) return;
      setHeightCm(String(profile.heightCm));
      setWeightKg(String(profile.weightKg));
      setStrideCm(String(profile.strideCm));
      setSex(profile.sex);
    });
  }, []);

  const isValidHeight = /^\d+(\.\d{1})?$/.test(heightCm);

  const parsedHeight =
    isValidHeight && heightCm !== "" && heightCm !== "."
      ? Number(heightCm)
      : null;

  const strideGuide =
    parsedHeight !== null
      ? {
          min: Math.round(parsedHeight * 0.42),
          max: Math.round(parsedHeight * 0.45),
        }
      : null;

  const handleSave = async () => {
    const height = Number(heightCm);
    const weight = Number(weightKg);
    const stride = Number(strideCm);

    if (isNaN(height) || isNaN(weight) || isNaN(stride)) {
      Alert.alert("입력 확인", "키, 몸무게, 보폭을 모두 입력해 주세요.");
      return;
    }

    if (height < 80 || height > 250) {
      Alert.alert("입력 확인", "키 값을 다시 확인해 주세요.");
      return;
    }

    if (weight < 20 || weight > 250) {
      Alert.alert("입력 확인", "몸무게 값을 다시 확인해 주세요.");
      return;
    }

    if (stride < 30 || stride > 200) {
      Alert.alert("입력 확인", "보폭은 cm 기준으로 다시 확인해 주세요.");
      return;
    }

    await saveProfile({
      heightCm: height,
      weightKg: weight,
      sex,
      strideCm: stride,
    });

    Alert.alert("저장 완료", "프로필이 저장되었습니다.", [
      { text: "확인", onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 6,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backText}>← 뒤로</Text>
          </Pressable>

          <Text style={styles.headerTitle}>프로필 설정</Text>

          <View style={{ width: 40 }} />
        </View>

        <View style={styles.introCard}>
          <Text style={styles.introTitle}>러닝 프로필 입력</Text>
          <Text style={styles.introDesc}>
            키, 몸무게, 성별, 보폭을 입력하면 칼로리 추정과 케이던스 계산,
            AI 코치 분석 정확도가 올라갑니다.
            {"\n"}
            각 입력 칸에는 숫자만(소수점 아래 1자리까지 허용) 입력합니다.
          </Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>키 (cm)</Text>
          <TextInput
            value={heightCm}
            onChangeText={(text) => {
              if (/^\d*\.?\d{0,1}$/.test(text)) setHeightCm(text);
            }}
            keyboardType="decimal-pad"
            placeholder="예: 175 또는 175.5"
            placeholderTextColor="#6F7A92"
            style={styles.input}
          />

          <Text style={styles.label}>몸무게 (kg)</Text>
          <TextInput
            value={weightKg}
            onChangeText={(text) => {
              if (/^\d*\.?\d{0,1}$/.test(text)) setWeightKg(text);
            }}
            keyboardType="decimal-pad"
            placeholder="예: 68 또는 68.5"
            placeholderTextColor="#6F7A92"
            style={styles.input}
          />

          <Text style={styles.label}>보폭 (cm)</Text>
          <TextInput
            value={strideCm}
            onChangeText={(text) => {
              if (/^\d*\.?\d{0,1}$/.test(text)) setStrideCm(text);
            }}
            keyboardType="decimal-pad"
            placeholder="예: 105 또는 105.5"
            placeholderTextColor="#6F7A92"
            style={styles.input}
          />

          {strideGuide ? (
            <Text style={styles.strideGuideText}>
              키 {parsedHeight}cm 기준 평균 보폭은 약{" "}
              <Text style={styles.strideGuideValue}>
                {strideGuide.min}~{strideGuide.max}cm
              </Text>
              입니다.
              {"\n"}
              러닝 스타일에 따라 차이가 있을 수 있습니다.
            </Text>
          ) : null}

          <Text style={styles.helpText}>
            보폭은 cm 단위입니다.
            {"\n"}
            (같은 발 기준 한 사이클 거리, 예: 왼발→오른발→왼발)
            {"\n"}
            보폭을 모르실 경우에는
            {"\n"} 
             10m 이동 후, 같은 발 기준 횟수로 나눠 계산하세요.
            {"\n"}
            (예: 10m ÷ 14회 ≈ 71.4cm)
            {"\n"} 
            입력 보폭은 초기 기준값이며, 상황에 따라 달라질 수 있습니다.
          </Text>

          <Text style={styles.label}>성별</Text>
          <View style={styles.sexRow}>
            <Pressable
              style={[
                styles.sexButton,
                sex === "남성" && styles.sexButtonActive,
              ]}
              onPress={() => setSex("남성")}
            >
              <Text
                style={[
                  styles.sexButtonText,
                  sex === "남성" && styles.sexButtonTextActive,
                ]}
              >
                남성
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.sexButton,
                sex === "여성" && styles.sexButtonActive,
              ]}
              onPress={() => setSex("여성")}
            >
              <Text
                style={[
                  styles.sexButtonText,
                  sex === "여성" && styles.sexButtonTextActive,
                ]}
              >
                여성
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>저장</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
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

  introCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
    marginBottom: 12,
  },

  introTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 6,
  },

  introDesc: {
    color: "#D8DEEA",
    fontSize: 14,
    lineHeight: 20,
  },

  formCard: {
    backgroundColor: "#151C31",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#2A3555",
  },

  label: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
    marginTop: 10,
  },

  input: {
    height: 48,
    borderRadius: 12,
    backgroundColor: "#101728",
    borderWidth: 1,
    borderColor: "#2A3555",
    paddingHorizontal: 12,
    color: "#FFFFFF",
    fontSize: 15,
  },

  helpText: {
    color: "#96A0B5",
    fontSize: 12,
    marginTop: 6,
  },

  sexRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },

  sexButton: {
    width: "48%",
    height: 46,
    borderRadius: 12,
    backgroundColor: "#101728",
    borderWidth: 1,
    borderColor: "#2A3555",
    alignItems: "center",
    justifyContent: "center",
  },

  sexButtonActive: {
    backgroundColor: "#FFFFFF",
  },

  sexButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  sexButtonTextActive: {
    color: "#111111",
  },

  saveButton: {
    marginTop: 16,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  saveButtonText: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "800",
  },

  strideGuideText: {
    color: "#B8C4DD",
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 2,
  },

  strideGuideValue: {
    color: "#EAF1FF",
    fontWeight: "700",
  },
});