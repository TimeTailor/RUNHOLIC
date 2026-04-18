import {
  InterstitialAd,
  AdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

const adUnitId = __DEV__
  ? TestIds.INTERSTITIAL
  : "ca-app-pub-9213010752576483/8890745434";

let interstitial: InterstitialAd | null = null;
let isLoaded = false;
let isShowing = false;
let pendingOnFinished: (() => void) | null = null;

export const bannerUnitId = __DEV__
  ? TestIds.BANNER
  : "ca-app-pub-9213010752576483/8755226096";

export function loadInterstitial() {
  if (interstitial) return;

  interstitial = InterstitialAd.createForAdRequest(adUnitId);

  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    isLoaded = true;
  });

  interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    isLoaded = false;
    isShowing = false;

    const callback = pendingOnFinished;
    pendingOnFinished = null;

    interstitial = null;
    loadInterstitial();

    callback?.();
  });

  interstitial.addAdEventListener(AdEventType.ERROR, () => {
    isLoaded = false;
    isShowing = false;

    const callback = pendingOnFinished;
    pendingOnFinished = null;

    interstitial = null;
    loadInterstitial();

    callback?.();
  });

  interstitial.load();
}

export function showInterstitial(onFinished?: () => void) {
  if (interstitial && isLoaded && !isShowing) {
    isShowing = true;
    pendingOnFinished = onFinished ?? null;
    interstitial.show();
  } else {
    onFinished?.();
  }
}