import { Image } from "react-native";
import React from "react";
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function SplashScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ImageBackground
      source={require("../assets/images/splash-runner-bg.jpg")}
      style={styles.background}
      resizeMode="cover"
    >
      <View style={styles.overlay} />

      <LinearGradient
        colors={["rgba(0,0,0,0.38)", "rgba(0,0,0,0.14)", "rgba(0,0,0,0.00)"]}
        locations={[0, 0.26, 0.58]}
        style={styles.topGradient}
      />

      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={[styles.topArea, { paddingTop: insets.top + 15 }]}>
            <Image
              source={require("../assets/images/logo_splash.png")}
              style={styles.logo}
            />
            <Text style={styles.subtitle}>당신의 페이스를 완성하다</Text>
          </View>

          <View style={styles.middleArea} />

          <View
            style={[
              styles.bottomArea,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.replace("/home")}
            >
              <Text style={styles.primaryButtonText}>시작하기</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#000000",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  topGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },
  topArea: {
    alignItems: "flex-start",
  },
  logo: {
    width: 220,
    height: 50,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    tintColor: undefined,
    marginBottom: 0,
    
  },
  subtitle: {
    marginTop: 10,
    marginLeft: 8,
    color: "rgba(255,255,255,0.88)",
    fontSize: 16,
    fontWeight: "500",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  middleArea: {
    flex: 1,
  },
  bottomArea: {
    justifyContent: "flex-end",
  },
  primaryButton: {
    height: 58,
    borderRadius: 29,
    backgroundColor: "#0284C7",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
});