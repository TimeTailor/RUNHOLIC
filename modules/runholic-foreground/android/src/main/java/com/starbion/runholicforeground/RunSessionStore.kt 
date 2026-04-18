package com.starbion.runholicforeground

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

object RunSessionStore {

    private const val DEFAULT_ANALYSIS = "러닝을 시작하면 AI 코치 분석이 표시됩니다."
    private const val GPS_LOSS_AUTO_PAUSE_KEY = "gps_signal_lost_pause"

    private const val VALID_GPS_ACCURACY_METERS = 40.0
    private const val GPS_LOSS_AUTO_PAUSE_TIMEOUT_MS = 35_000L

    private var sessionId: String? = null
    private var isRunning = false
    private var isPaused = false
    private var startedAt = 0L

    private var pausedAccumulatedMs = 0L
    private var pauseStartedAtMs: Long? = null

    private var elapsedMs = 0L
    private var distanceMeters = 0.0

    private var avgPaceSec = 0.0
    private var currentPaceSec = 0.0
    private var paceState = "안정"
    private var avgPaceLevel = "보통"

    private var elevationGainMeters = 0.0
    private var elevationLossMeters = 0.0
    private var cadence = 0.0
    private var calories = 0.0
    private var netElevationMeters = 0.0

    // 고도 10m 구간 집계용
    private var elevationSegmentDistanceAccum = 0.0
    private val elevationSegmentAltSamples = mutableListOf<Double>()
    private var previousElevationSegmentMedianAlt: Double? = null

    private var pendingElevationGainMeters = 0.0
    private var pendingElevationLossMeters = 0.0

    private var targetDistanceKm: Double? = null
    private var aiCoachAnalysis = DEFAULT_ANALYSIS
    private var runnerType = "중립"
    private var runnerTrait = "미분류"

    private var routeSegments = mutableListOf<MutableList<RoutePointState>>()
    private var splits = mutableListOf<RunSplitState>()
    private var lastPoint: RoutePointState? = null

    private var lastSplitDistanceKm = 0.0
    private var lastSplitElapsedSec = 0L
    private var lastSplitNetElevationM = 0.0
    private var lastSplitElevationGainM = 0.0
    private var lastSplitElevationLossM = 0.0
    private var lastAnnouncedKm = 0

    private var hasAnnouncedHalfKm = false
    private var hasAnnouncedLast500m = false
    private var hasAnnouncedFinal200m = false
    private var hasAnnouncedTargetReached = false
    private var ignorePointsBeforeTs = 0L

    private var weightKg = 0.0
    private var strideCm = 0.0
    private var heightCm = 0.0
    private var sex = "남성"
    private var lastAnalysisUpdatedSec = 0L

    private var lastMessageKey: String? = null

    private var lastValidGpsAtMs = 0L
    private var gpsSignalLostAtMs: Long? = null
    private var lastGpsCallbackAtMs = 0L
    private var recentStillSinceMs: Long? = null
    private var lastMovementDetectedAtMs = 0L
    private var resumedAtMs: Long = 0L
    private var autoPausedByGpsLoss = false
    private var gpsLossNoticePending = false
    private var ignoreElevationUntilMs = 0L

    private var startupAnchorPoint: RoutePointState? = null
    private var startupMapLastPoint: RoutePointState? = null
    private var startupDistanceCredited = false

    private val pendingAnnouncements = mutableListOf<SpeechAnnouncementState>()

    data class MessageBlock(
        val observation: List<String>,
        val interpretation: List<String>,
        val action: List<String>,
    )

    data class SpecialAnnouncement(
        val shouldAnnounce: Boolean,
        val type: String?,
        val reportText: String,
        val coachText: String,
    )

    data class KmAnnouncement(
        val shouldAnnounce: Boolean,
        val km: Int,
        val reportText: String,
        val coachText: String,
    )

    private val personalHints: Map<String, List<String>> = mapOf(
        "초반과속형" to listOf(
            "비슷한 흐름에서 부담이 커졌던 패턴이 있습니다.",
            "이전 러닝에서도 비슷한 강도에서 리듬이 흔들린 적이 있어요.",
            "최근 패턴을 보면 속도가 높아질 때 유지가 어려웠던 경향이 있습니다."
        ),
        "후반약화형" to listOf(
            "최근 러닝에서도 유지력이 흔들리는 흐름이 반복됐습니다.",
            "비슷한 패턴에서 리듬 저하가 나타난 적이 있어요.",
            "지금과 비슷한 흐름에서 속도 유지가 어려웠던 기록이 있습니다."
        ),
        "안정유지형" to listOf(
            "최근 러닝에서도 비슷한 안정 흐름이 잘 이어졌습니다.",
            "지금 같은 균형은 최근 패턴과도 잘 맞습니다.",
            "비슷한 흐름에서 꾸준한 유지가 잘 됐던 편입니다."
        ),
        "변동형" to listOf(
            "최근 러닝에서도 흐름 변화가 비교적 크게 나타났습니다.",
            "비슷한 패턴에서 리듬 변동 폭이 컸던 편입니다.",
            "최근 기록을 보면 속도 변화가 자주 나타나는 편입니다."
        )
    )

    private val avgPaceLevelHints: Map<String, List<String>> = mapOf(
        "빠름" to listOf(
            "현재 평균보다 빠른 페이스입니다.",
            "전체 평균보다 높은 강도로 달리고 있습니다.",
            "평균보다 빠른 흐름이 이어지고 있습니다."
        ),
        "보통" to listOf(
            "현재 평균과 비슷한 페이스를 유지하고 있습니다.",
            "전체 평균과 큰 차이 없는 흐름입니다.",
            "평균 수준의 페이스가 이어지고 있습니다."
        ),
        "느림" to listOf(
            "현재 평균보다 느린 페이스입니다.",
            "전체 평균보다 다소 낮은 속도로 이어지고 있습니다.",
            "평균보다 느린 흐름이 나타나고 있습니다."
        )
    )

private val coachingPools: Map<String, Map<String, MessageBlock>> = mapOf(
    "중립" to mapOf(
        "가속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 페이스가 올라가고 있습니다.",
                "이전 흐름보다 속도가 점진적으로 높아지고 있습니다.",
                "리듬이 직전 구간보다 빠른 쪽으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "현재는 주행 성향을 확정하기 전 단계라 이런 변화가 일시적일 수도 있습니다.",
                "지금 구간은 패턴이 형성되는 과정이라 상승 흐름이 유지되는지 더 지켜볼 필요가 있습니다.",
                "아직은 성향 판단보다 변동 폭 자체를 확인하는 단계에 가깝습니다."
            ),
            action = listOf(
                "지금 속도를 더 끌어올리기보다 현재 리듬을 일정하게 유지해 보세요.",
                "보폭과 스텝 템포를 급하게 바꾸지 말고 자연스럽게 이어가세요.",
                "가속이 과해지지 않도록 힘을 조금만 덜 쓰는 방향으로 조정하세요."
            )
        ),
        "안정" to MessageBlock(
            observation = listOf(
                "직전 구간과 비슷한 페이스가 유지되고 있습니다.",
                "속도 변화 없이 일정한 흐름이 이어지고 있습니다.",
                "리듬 변동이 크지 않은 안정 구간입니다."
            ),
            interpretation = listOf(
                "현재는 러닝 성향을 판단하기 위한 데이터가 누적되는 단계입니다.",
                "이 구간은 특별한 보정보다 현재 흐름이 반복되는지를 확인하는 것이 중요합니다.",
                "지금은 패턴이 무너지지 않고 유지되는지를 보는 구간입니다."
            ),
            action = listOf(
                "지금 리듬을 그대로 유지하면서 불필요한 변화만 줄이세요.",
                "속도를 바꾸기보다 현재 흐름을 일정하게 이어가세요.",
                "몸의 긴장을 줄이고 같은 템포를 반복하는 데 집중하세요."
            )
        ),
        "감속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 페이스가 내려가고 있습니다.",
                "이전 흐름보다 속도가 점차 낮아지고 있습니다.",
                "리듬이 직전 구간보다 느린 쪽으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "현재 감속은 일시적인 피로 반응일 가능성이 있습니다.",
                "이 흐름이 반복되는지 여부를 더 봐야 성향 차원의 패턴으로 해석할 수 있습니다.",
                "지금은 붕괴라기보다 변동 구간으로 보는 편이 더 적절합니다."
            ),
            action = listOf(
                "속도를 바로 끌어올리기보다 리듬부터 다시 일정하게 맞추세요.",
                "보폭이나 케이던스를 한 번에 크게 바꾸지 말고 흐름을 먼저 회복하세요.",
                "짧은 구간에서 자연스럽게 다시 붙는 느낌으로 주행을 이어가세요."
            )
        )
    ),

    "지속형" to mapOf(
        "가속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 페이스가 올라가고 있습니다.",
                "안정 흐름에서 벗어나 속도가 높아지는 구간입니다.",
                "리듬이 평소 유지 범위를 넘어 빠른 쪽으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "지속형 러너는 과한 가속이 길어질수록 후반 유지력이 먼저 무너질 가능성이 큽니다.",
                "현재는 에너지 소모 속도가 평소보다 빨라지면서 효율이 떨어질 수 있는 구간입니다.",
                "이 흐름이 계속되면 전체 페이스 균형이 흔들릴 가능성이 높습니다."
            ),
            action = listOf(
                "속도를 더 올리기보다 현재 리듬을 안정 범위 안으로 다시 가져오세요.",
                "보폭과 스텝 템포를 평소 유지하던 범위에 맞춰 소폭 정리하세요.",
                "후반 유지력을 남긴다는 기준으로 지금 페이스를 조금만 눌러 보세요."
            )
        ),
        "안정" to MessageBlock(
            observation = listOf(
                "직전 구간과 유사한 페이스가 유지되고 있습니다.",
                "속도 변화 없이 일정한 흐름이 이어지고 있습니다.",
                "리듬 변동이 거의 없는 안정 구간입니다."
            ),
            interpretation = listOf(
                "지속형 러너에게 가장 효율적인 에너지 사용 구간입니다.",
                "속도 변동이 적어 불필요한 에너지 손실이 최소화되고 있습니다.",
                "이 흐름은 장거리에서 가장 안정적인 결과를 만들 가능성이 높습니다."
            ),
            action = listOf(
                "지금 리듬을 유지하는 데 집중하고 변화는 최소화하세요.",
                "속도를 새로 만들기보다 현재 흐름을 오래 이어가는 데 초점을 두세요.",
                "보폭과 스텝 템포를 일정하게 유지해 전체 균형을 지키세요."
            )
        ),
        "감속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 페이스가 내려가고 있습니다.",
                "안정 흐름에서 벗어나 속도가 낮아지는 구간입니다.",
                "리듬이 점차 느려지는 방향으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "지속형 러너는 감속 흐름이 길어질수록 전체 평균 페이스가 함께 무너질 수 있습니다.",
                "현재는 리듬 유지력이 떨어지면서 효율도 같이 낮아지는 구간입니다.",
                "이 상태가 이어지면 후반 회복 없이 전체 주행 흐름이 느슨해질 가능성이 큽니다."
            ),
            action = listOf(
                "속도를 억지로 끌어올리기보다 먼저 일정한 리듬을 다시 만드는 데 집중하세요.",
                "보폭보다 스텝 템포를 안정시키면서 흐름을 다시 붙여 보세요.",
                "짧은 구간이라도 평소 유지 페이스에 가까운 리듬을 다시 회복해 보세요."
            )
        )
    ),

    "변속형" to mapOf(
        "가속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 속도가 올라가고 있습니다.",
                "강도가 빠르게 상승하는 전환 구간입니다.",
                "리듬이 상향 전환되는 흐름입니다."
            ),
            interpretation = listOf(
                "변속형 러너는 가속 자체보다 전환 타이밍이 무너지면 전체 흐름이 끊기기 쉽습니다.",
                "현재는 가속 구간이 길어지면서 다음 회복 전환이 늦어질 가능성이 있습니다.",
                "이 흐름이 이어지면 전환 리듬이 거칠어져 전체 운영이 무거워질 수 있습니다."
            ),
            action = listOf(
                "가속을 길게 끌기보다 다음 전환 시점을 의식하면서 주행하세요.",
                "강도를 더 올리기보다 리듬 연결이 부드럽게 이어지도록 조정하세요.",
                "지금 구간은 기록보다 전환 완성도를 우선한다는 기준으로 운영하세요."
            )
        ),
        "안정" to MessageBlock(
            observation = listOf(
                "직전 구간과 유사한 강도로 이어지고 있습니다.",
                "전환 폭이 크지 않은 상태로 유지되고 있습니다.",
                "리듬이 일정 범위 안에서 반복되고 있습니다."
            ),
            interpretation = listOf(
                "현재는 전환 타이밍과 리듬 연결이 안정적으로 유지되는 구간입니다.",
                "강도 변화가 과하지 않아 변속형 패턴이 가장 효율적으로 작동하고 있습니다.",
                "이 상태는 회복과 가속의 연결이 끊기지 않는 좋은 흐름입니다."
            ),
            action = listOf(
                "지금 전환 리듬을 그대로 유지하면서 과한 강도 변화만 피하세요.",
                "각 구간의 길이를 비슷하게 가져가며 리듬 연결을 유지하세요.",
                "속도 자체보다 전환이 매끄럽게 이어지는지에 집중하세요."
            )
        ),
        "감속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 속도가 내려가고 있습니다.",
                "강도가 낮아지는 전환 구간입니다.",
                "리듬이 하향 전환되는 흐름입니다."
            ),
            interpretation = listOf(
                "변속형 러너는 감속 구간이 길어질수록 다음 가속 연결이 늦어질 수 있습니다.",
                "현재는 회복 흐름이 필요 이상 길어지면서 전환 리듬이 느슨해지는 상태입니다.",
                "이 흐름이 계속되면 변속의 장점이 약해질 가능성이 큽니다."
            ),
            action = listOf(
                "회복 구간을 길게 끌지 말고 다음 가속으로 자연스럽게 연결하세요.",
                "지금은 속도 회복보다 전환 타이밍 회복을 먼저 의식하세요.",
                "리듬이 끊기지 않도록 강도 변화를 부드럽게 이어가세요."
            )
        )
    ),

    "케이던스형" to mapOf(
        "가속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 케이던스가 올라가고 있습니다.",
                "스텝 템포가 빠르게 상승하는 구간입니다.",
                "리듬이 상향 흐름으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "케이던스형 러너는 템포가 과하게 빨라질수록 상체 긴장과 호흡 불균형이 함께 나타날 수 있습니다.",
                "현재는 리듬이 효율 범위를 넘어갈 가능성이 있는 구간입니다.",
                "이 흐름이 길어지면 템포 유지보다 리듬 붕괴가 먼저 올 수 있습니다."
            ),
            action = listOf(
                "케이던스를 더 올리기보다 현재 템포를 안정시키는 쪽으로 조정하세요.",
                "스텝을 짧고 일정하게 유지하면서 리듬만 정리하세요.",
                "상체 힘을 빼고 템포 상승 폭을 조금 눌러 보세요."
            )
        ),
        "안정" to MessageBlock(
            observation = listOf(
                "직전 구간과 유사한 케이던스가 유지되고 있습니다.",
                "스텝 템포가 일정하게 이어지고 있습니다.",
                "리듬 변동 없이 안정적으로 유지되고 있습니다."
            ),
            interpretation = listOf(
                "현재는 리듬 유지력이 가장 효율적으로 작동하는 구간입니다.",
                "호흡과 스텝 템포가 균형을 이루고 있어 에너지 손실이 적습니다.",
                "이 흐름은 템포 중심 주행을 오래 유지하기에 적합한 상태입니다."
            ),
            action = listOf(
                "현재 템포를 그대로 유지하면서 리듬 변화를 최소화하세요.",
                "보폭을 억지로 바꾸지 말고 스텝 리듬 유지에 집중하세요.",
                "상체 힘을 빼고 현재 템포를 편하게 반복하세요."
            )
        ),
        "감속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 케이던스가 내려가고 있습니다.",
                "스텝 템포가 느려지는 구간입니다.",
                "리듬이 하향 흐름으로 이동하고 있습니다."
            ),
            interpretation = listOf(
                "케이던스형 러너는 템포가 떨어질수록 전체 리듬이 한꺼번에 무너지기 쉽습니다.",
                "현재는 리듬 유지력이 약해지면서 효율도 같이 떨어지는 상태입니다.",
                "이 흐름이 이어지면 속도 회복보다 리듬 복구가 더 어려워질 수 있습니다."
            ),
            action = listOf(
                "보폭을 늘리기보다 먼저 스텝 템포를 다시 살리세요.",
                "짧고 빠른 스텝으로 기본 리듬을 회복하는 데 집중하세요.",
                "속도를 한 번에 올리려 하지 말고 템포부터 다시 맞추세요."
            )
        )
    ),

    "스트라이드형" to mapOf(
        "가속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 보폭이 증가하고 있습니다.",
                "추진력이 강해지는 구간입니다.",
                "보폭 확장으로 속도가 올라가는 흐름입니다."
            ),
            interpretation = listOf(
                "스트라이드형 러너는 보폭 증가가 길어질수록 하체 피로가 누적되어 후반 유지가 어려워질 수 있습니다.",
                "현재는 추진력 사용이 증가하면서 에너지 소모도 빠르게 커지는 구간입니다.",
                "이 흐름이 이어지면 속도는 유지돼도 효율은 점차 떨어질 가능성이 있습니다."
            ),
            action = listOf(
                "보폭을 조금만 줄이고 리듬 중심으로 다시 조정하세요.",
                "힘으로 밀어내기보다 추진을 자연스럽게 이어가는 데 집중하세요.",
                "하체 부담이 커지기 전에 보폭 상승 폭을 살짝 눌러 보세요."
            )
        ),
        "안정" to MessageBlock(
            observation = listOf(
                "직전 구간과 유사한 보폭이 유지되고 있습니다.",
                "추진 흐름이 일정하게 이어지고 있습니다.",
                "보폭 변화 없이 안정적인 주행이 이어지고 있습니다."
            ),
            interpretation = listOf(
                "현재는 추진과 리듬이 균형을 이루는 구간입니다.",
                "보폭 기반 주행이 효율적으로 유지되고 있어 에너지 손실이 적습니다.",
                "이 흐름은 후반까지 무리 없이 이어가기 좋은 상태입니다."
            ),
            action = listOf(
                "현재 보폭과 리듬을 그대로 유지하세요.",
                "힘을 과하게 더하지 말고 지금 추진 흐름을 반복하세요.",
                "보폭을 억지로 키우거나 줄이지 말고 균형을 유지하세요."
            )
        ),
        "감속" to MessageBlock(
            observation = listOf(
                "직전 구간 대비 보폭이 줄어들고 있습니다.",
                "추진력이 약해지는 구간입니다.",
                "보폭 축소로 속도가 내려가는 흐름입니다."
            ),
            interpretation = listOf(
                "스트라이드형 러너는 보폭 감소가 이어질수록 추진력 저하가 먼저 나타날 수 있습니다.",
                "현재는 하체 힘 전달이 약해지면서 속도 회복 여지가 줄어드는 상태입니다.",
                "이 흐름이 지속되면 후반에 다시 끌어올리기 어려워질 수 있습니다."
            ),
            action = listOf(
                "보폭을 억지로 크게 늘리기보다 추진 감각을 먼저 회복하세요.",
                "지면을 뒤로 밀어내는 느낌을 다시 살리면서 흐름을 붙이세요.",
                "하체 힘 전달을 다시 연결하는 데 집중하고 속도 회복은 그다음으로 두세요."
            )
        )
    )
)

    fun startNewSession(
        id: String,
        targetDistanceKm: Double?,
        weightKg: Double,
        strideCm: Double,
        heightCm: Double,
        sex: String,
        runnerType: String,
        runnerTrait: String,
        currentLocation: RoutePointState? = null,
    ) {
        val now = System.currentTimeMillis()

        sessionId = id
        isRunning = true
        isPaused = false
        startedAt = now

        pausedAccumulatedMs = 0L
        pauseStartedAtMs = null

        elapsedMs = 0L
        distanceMeters = 0.0
        avgPaceSec = 0.0
        currentPaceSec = 0.0
        paceState = "안정"
        avgPaceLevel = "보통"

        elevationGainMeters = 0.0
        elevationLossMeters = 0.0
        netElevationMeters = 0.0
        cadence = 0.0
        calories = 0.0

        this.targetDistanceKm = targetDistanceKm
        this.aiCoachAnalysis = DEFAULT_ANALYSIS
        this.runnerType = runnerType
        this.runnerTrait = runnerTrait

        routeSegments = mutableListOf(
            mutableListOf<RoutePointState>().apply {
                if (currentLocation != null) add(currentLocation)
            }
        )
        splits.clear()
        lastPoint = currentLocation
        startupAnchorPoint = currentLocation
        startupMapLastPoint = currentLocation
        startupDistanceCredited = false

        lastSplitDistanceKm = 0.0
        lastSplitElapsedSec = 0L
        lastSplitNetElevationM = 0.0
        lastSplitElevationGainM = 0.0
        lastSplitElevationLossM = 0.0
        lastAnnouncedKm = 0

        lastMessageKey = null

        hasAnnouncedHalfKm = false
        hasAnnouncedLast500m = false
        hasAnnouncedFinal200m = false
        hasAnnouncedTargetReached = false
        ignorePointsBeforeTs = now + 8000L

        this.weightKg = weightKg
        this.strideCm = strideCm
        this.heightCm = heightCm
        this.sex = sex
        lastAnalysisUpdatedSec = 0L
        
        lastValidGpsAtMs = now
        gpsSignalLostAtMs = null
        lastGpsCallbackAtMs = now
        recentStillSinceMs = now
        lastMovementDetectedAtMs = now
        autoPausedByGpsLoss = false
        gpsLossNoticePending = false
        ignoreElevationUntilMs = 0L
        pendingAnnouncements.clear()
        resumedAtMs = 0L

        elevationSegmentDistanceAccum = 0.0
        elevationSegmentAltSamples.clear()
        previousElevationSegmentMedianAlt = null
        pendingElevationGainMeters = 0.0
        pendingElevationLossMeters = 0.0
    }

    fun pause() {
        if (!isRunning || isPaused) return

        val now = System.currentTimeMillis()
        elapsedMs = computeElapsedMs(now)
        avgPaceSec = if (distanceMeters > 0.0) elapsedMs / 1000.0 / (distanceMeters / 1000.0) else 0.0

        isPaused = true
        pauseStartedAtMs = now
        ignorePointsBeforeTs = now
    }

    fun autoPauseByGpsLoss(lostAtMs: Long) {
        if (!isRunning || isPaused) return

        val now = System.currentTimeMillis()
        elapsedMs = computeElapsedMs(now)
        avgPaceSec = if (distanceMeters > 0.0) elapsedMs / 1000.0 / (distanceMeters / 1000.0) else 0.0

        enqueuePendingAnnouncement(
            SpeechAnnouncementState(
                key = GPS_LOSS_AUTO_PAUSE_KEY,
                reportText = "GPS 신호가 끊어져 러닝을 일시정지합니다. 신호가 회복되면 재개 버튼을 눌러 주세요.",
                coachText = null,
            )
        )

        isPaused = true
        pauseStartedAtMs = now
        ignorePointsBeforeTs = now
        gpsSignalLostAtMs = lostAtMs
        autoPausedByGpsLoss = true
        gpsLossNoticePending = true
    }

    fun resume(currentLocation: RoutePointState? = null) {
        if (!isRunning || !isPaused) return

        val resumedAt = System.currentTimeMillis()
        resumedAtMs = resumedAt
        pauseStartedAtMs?.let { pausedAccumulatedMs += resumedAt - it }

        pauseStartedAtMs = null
        isPaused = false
        ignorePointsBeforeTs = resumedAt
        
        lastValidGpsAtMs = resumedAt
        gpsSignalLostAtMs = null
        lastGpsCallbackAtMs = resumedAt
        recentStillSinceMs = resumedAt
        lastMovementDetectedAtMs = resumedAt
        autoPausedByGpsLoss = false
        gpsLossNoticePending = false
        ignoreElevationUntilMs = resumedAt + 5000L

        elevationSegmentDistanceAccum = 0.0
        elevationSegmentAltSamples.clear()
        previousElevationSegmentMedianAlt = null
        pendingElevationGainMeters = 0.0
        pendingElevationLossMeters = 0.0

        if (currentLocation != null) {
            lastPoint = currentLocation
            if (routeSegments.isEmpty()) {
                routeSegments.add(mutableListOf(currentLocation))
            } else {
                routeSegments.add(mutableListOf(currentLocation))
            }
        } else {
            lastPoint = null
            routeSegments.add(mutableListOf())
        }

        startupAnchorPoint = currentLocation
        startupMapLastPoint = currentLocation
        startupDistanceCredited = false
    }

    fun stop(currentLocation: RoutePointState? = null) {
        if (!isRunning) return

        val now = System.currentTimeMillis()
        elapsedMs = computeElapsedMs(now)

        if (currentLocation != null) {
            lastPoint = currentLocation

            if (routeSegments.isEmpty()) {
                routeSegments.add(mutableListOf(currentLocation))
            } else {
                val lastSegment = routeSegments.lastOrNull()
                if (lastSegment == null) {
                    routeSegments.add(mutableListOf(currentLocation))
                } else {
                    val lastSaved = lastSegment.lastOrNull()
                    val isSamePoint =
                        lastSaved != null &&
                        kotlin.math.abs(lastSaved.latitude - currentLocation.latitude) < 0.0000001 &&
                        kotlin.math.abs(lastSaved.longitude - currentLocation.longitude) < 0.0000001

                    if (!isSamePoint) {
                        lastSegment.add(currentLocation)
                    }
                }
            }
        }

        if (lastPoint == null && routeSegments.isNotEmpty()) {
            val lastSegment = routeSegments.lastOrNull()
            val fallback = lastSegment?.lastOrNull()
            if (fallback != null) {
                lastPoint = fallback
            }
        }

        val flushedElevation = flushElevationSegmentOnStop()
        if (
            flushedElevation.gainApplied != 0.0 ||
            flushedElevation.lossApplied != 0.0 ||
            flushedElevation.netDeltaApplied != 0.0
        ) {
            elevationGainMeters += flushedElevation.gainApplied
            elevationLossMeters += flushedElevation.lossApplied
            netElevationMeters += flushedElevation.netDeltaApplied
        }

        isRunning = false
        isPaused = false
        pauseStartedAtMs = null
    }

    fun clear() {
        sessionId = null
        isRunning = false
        isPaused = false
        startedAt = 0L
        pausedAccumulatedMs = 0L
        pauseStartedAtMs = null
        elapsedMs = 0L
        distanceMeters = 0.0
        avgPaceSec = 0.0
        currentPaceSec = 0.0
        paceState = "안정"
        avgPaceLevel = "보통"
        elevationGainMeters = 0.0
        elevationLossMeters = 0.0
        netElevationMeters = 0.0

        elevationSegmentDistanceAccum = 0.0
        elevationSegmentAltSamples.clear()
        previousElevationSegmentMedianAlt = null
        pendingElevationGainMeters = 0.0
        pendingElevationLossMeters = 0.0

        cadence = 0.0
        calories = 0.0
        targetDistanceKm = null
        aiCoachAnalysis = DEFAULT_ANALYSIS
        runnerType = "중립"
        runnerTrait = "미분류"
        routeSegments.clear()
        splits.clear()
        lastPoint = null
        lastSplitDistanceKm = 0.0
        lastSplitElapsedSec = 0L
        lastSplitNetElevationM = 0.0
        lastSplitElevationGainM = 0.0
        lastSplitElevationLossM = 0.0
        lastAnnouncedKm = 0
        lastMessageKey = null
        hasAnnouncedHalfKm = false
        hasAnnouncedLast500m = false
        hasAnnouncedFinal200m = false
        hasAnnouncedTargetReached = false
        ignorePointsBeforeTs = 0L
        ignoreElevationUntilMs = 0L
        weightKg = 0.0
        strideCm = 0.0
        heightCm = 0.0
        sex = "남성"
        lastAnalysisUpdatedSec = 0L
        lastValidGpsAtMs = 0L
        gpsSignalLostAtMs = null
        lastGpsCallbackAtMs = 0L
        recentStillSinceMs = null
        lastMovementDetectedAtMs = 0L
        autoPausedByGpsLoss = false
        gpsLossNoticePending = false
        startupAnchorPoint = null
        startupMapLastPoint = null
        startupDistanceCredited = false
        pendingAnnouncements.clear()
    }

    fun onLocation(point: RoutePointState) {
        if (!isRunning || isPaused) return

        lastGpsCallbackAtMs =
            point.timestamp.takeIf { it > 0L } ?: System.currentTimeMillis()

        val elapsedSec = getElapsedSec()

        val prev = lastPoint
        updateStillState(prev, point)
        val accuracy = point.accuracy ?: 999.0
        val inStartupMapOnlyWindow = isInStartupMapOnlyWindow(point)

        if (inStartupMapOnlyWindow) {
            if (!shouldAcceptStartupMapPoint(prev, point)) return

            appendRoute(point)
            lastPoint = point
            startupMapLastPoint = point

            if (accuracy <= VALID_GPS_ACCURACY_METERS) {
                lastValidGpsAtMs = point.timestamp.takeIf { it > 0L } ?: System.currentTimeMillis()
                gpsSignalLostAtMs = null
            }

            return
        }

        if (elapsedSec < 10 && accuracy > 45.0) return
        if (!isValidAccuracy(point, elapsedSec)) return

        if (prev != null && !isValidMovement(prev, point, elapsedSec)) return

        if (!startupDistanceCredited) {
            val anchor = startupAnchorPoint
            val startupLast = startupMapLastPoint ?: point

            if (anchor != null) {
                val startupDistanceM = calcDistanceMeters(anchor, startupLast)

                if (startupDistanceM in 3.0..80.0) {
                    distanceMeters += startupDistanceM
                }
            }

            startupDistanceCredited = true
        }

        appendRoute(point)
        val flatRoute = flattenRoute()

        var nextDistance = distanceMeters
        var nextElevation = elevationGainMeters
        var nextLoss = elevationLossMeters
        var nextNetElevation = netElevationMeters

        if (prev != null) {
            val segmentDistanceM = calcDistanceMeters(prev, point)
            nextDistance += segmentDistanceM

            val elevationUpdate = processElevationSegment(
                point = point,
                segmentDistanceM = segmentDistanceM,
                elapsedSec = elapsedSec
            )

            nextElevation += elevationUpdate.gainApplied
            nextLoss += elevationUpdate.lossApplied
            nextNetElevation += elevationUpdate.netDeltaApplied
        }

        val nextElapsedSec = elapsedSec.toLong()
        val nextAvgPace = if (nextDistance > 0.0 && nextElapsedSec > 0L) nextElapsedSec / (nextDistance / 1000.0) else 0.0
        val nextCurrentPace = calculateRecentPaceFromRoute(flatRoute)

        val nextCalories = estimateCalories(
            weightKg = weightKg,
            distanceKm = nextDistance / 1000.0,
            sex = sex,
            heightCm = heightCm
        )

        val nextCadence = estimateCadence(
            distanceKm = nextDistance / 1000.0,
            durationSec = nextElapsedSec.toDouble(),
            strideCm = strideCm
        )

        val recentBaselinePace = getRecentBaselinePace(flatRoute, nextAvgPace)
        val effectiveAvgPace = if (nextAvgPace > 0.0) nextAvgPace else recentBaselinePace
        val hybridBaselinePace = when {
            recentBaselinePace > 0.0 && effectiveAvgPace > 0.0 -> recentBaselinePace * 0.7 + effectiveAvgPace * 0.3
            recentBaselinePace > 0.0 -> recentBaselinePace
            effectiveAvgPace > 0.0 -> effectiveAvgPace
            else -> 0.0
        }

        val effectiveCurrentPace =
            if (nextCurrentPace > 0.0) nextCurrentPace else hybridBaselinePace

        val nextPaceState =
            if (nextElapsedSec < 20L) "안정"
            else detectLivePaceState(
                effectiveCurrentPace,
                hybridBaselinePace,
                paceState
            )

        val nextAvgPaceLevel =
            if (nextElapsedSec < 20L || nextAvgPace <= 0.0) "보통"
            else detectAvgPaceLevel(
                effectiveCurrentPace,
                nextAvgPace
            )

        updateSplits(
            nextDistance,
            nextElapsedSec,
            nextElevation,
            nextLoss,
            nextNetElevation
        )

        val paceStateChanged = nextPaceState != paceState
        val avgLevelChanged = nextAvgPaceLevel != avgPaceLevel
        val timeElapsed = nextElapsedSec - lastAnalysisUpdatedSec

        if (paceStateChanged || avgLevelChanged || timeElapsed > 60L || aiCoachAnalysis.isBlank()) {
            aiCoachAnalysis = buildLiveAiCoachAnalysis(
                runnerType,
                runnerTrait,
                nextPaceState,
                nextAvgPaceLevel
            )
            lastAnalysisUpdatedSec = nextElapsedSec
        }

        distanceMeters = nextDistance
        elapsedMs = nextElapsedSec * 1000L
        avgPaceSec = nextAvgPace
        currentPaceSec = effectiveCurrentPace
        calories = nextCalories
        cadence = nextCadence
        elevationGainMeters = nextElevation
        elevationLossMeters = nextLoss
        netElevationMeters = nextNetElevation
        paceState = nextPaceState
        avgPaceLevel = nextAvgPaceLevel
        lastPoint = point

        if (accuracy <= VALID_GPS_ACCURACY_METERS) {
            lastValidGpsAtMs = point.timestamp.takeIf { it > 0L } ?: System.currentTimeMillis()
            gpsSignalLostAtMs = null
        }

        val before = pendingAnnouncements.size
        enqueueSpecialDistanceAnnouncement()
        if (pendingAnnouncements.size == before) {
            enqueueKmAnnouncement()
        }
    }

    private fun updateStillState(prev: RoutePointState?, next: RoutePointState) {
        val now = next.timestamp.takeIf { it > 0L } ?: System.currentTimeMillis()

        if (prev == null) {
            recentStillSinceMs = now
            return
        }

        val distanceM = calcDistanceMeters(prev, next)
        val prevTs = prev.timestamp
        val nextTs = next.timestamp
        val deltaSec =
            if (prevTs > 0L && nextTs > 0L) ((nextTs - prevTs) / 1000.0).coerceAtLeast(0.1)
            else 1.0

        val speedMps = distanceM / deltaSec

        // 사실상 정지 상태
        val isStill = distanceM < 3.0 && speedMps < 0.8

        if (isStill) {
            if (recentStillSinceMs == null) {
                recentStillSinceMs = now
            }
       } else {
           val stillDurationMs =
               if (recentStillSinceMs != null) now - recentStillSinceMs!! else 0L

           if (stillDurationMs >= 3000L) {
               ignoreElevationUntilMs = now + 5000L
           }

           recentStillSinceMs = null
           lastMovementDetectedAtMs = now
       }
    }

    fun shouldAutoPauseForGpsLoss(
        nowMs: Long = System.currentTimeMillis(),
        timeoutMs: Long = GPS_LOSS_AUTO_PAUSE_TIMEOUT_MS
    ): Boolean {
        if (!isRunning || isPaused) return false

        // 정지 상태면 자동정지 안 함
        val stillSince = recentStillSinceMs
        if (stillSince != null && nowMs - stillSince >= 8000L) {
            return false
        }

        // 🔥 최근 움직임 있으면 자동정지 안 함 (추가)
        if (nowMs - lastMovementDetectedAtMs < 5000L) {
            return false
        }

        return nowMs - lastGpsCallbackAtMs >= timeoutMs
    }

    fun clearGpsLossNoticePending() {
        gpsLossNoticePending = false
    }

    fun drainPendingAnnouncements(): List<SpeechAnnouncementState> {
        val items = pendingAnnouncements.toList()
        pendingAnnouncements.clear()
        return items
    }

    fun tick(now: Long = System.currentTimeMillis()) {
        if (!isRunning) return
        if (isPaused) return

        elapsedMs = computeElapsedMs(now)

        avgPaceSec = if (distanceMeters > 0.0) {
            elapsedMs / 1000.0 / (distanceMeters / 1000.0)
        } else {
            0.0
        }
    }

    fun snapshot(notificationVisible: Boolean = true): RunSessionState {
        val remaining = targetDistanceKm?.let { max(0.0, it - distanceMeters / 1000.0) }

        return RunSessionState(
            sessionId = sessionId,
            isRunning = isRunning,
            isPaused = isPaused,
            startedAt = startedAt,
            resumedAt = resumedAtMs,
            elapsedMs = elapsedMs,
            durationSec = elapsedMs / 1000L,
            distanceMeters = distanceMeters,
            avgPaceSec = avgPaceSec,
            currentPaceSec = currentPaceSec,
            paceState = paceState,
            avgPaceLevel = avgPaceLevel,
            elevationGainMeters = elevationGainMeters,
            elevationLossMeters = elevationLossMeters,
            cadence = cadence,
            calories = calories,
            targetDistanceKm = targetDistanceKm,
            remainingDistanceKm = remaining,
            aiCoachAnalysis = aiCoachAnalysis,
            runnerType = runnerType,
            runnerTrait = runnerTrait,
            routeSegments = routeSegments.map { it.toList() },
            splits = splits.toList(),
            lastPoint = lastPoint,
            autoPausedByGpsLoss = autoPausedByGpsLoss,
            gpsLossNoticePending = gpsLossNoticePending,
            pendingAnnouncements = pendingAnnouncements.toList(),
            notificationVisible = notificationVisible,
        )
    }

    private fun computeElapsedMs(now: Long): Long {
        return max(0L, now - startedAt - pausedAccumulatedMs)
    }

    private fun getElapsedSec(): Int {
        return floor(computeElapsedMs(System.currentTimeMillis()) / 1000.0).toInt()
    }

    private fun appendRoute(point: RoutePointState) {
        if (routeSegments.isEmpty()) routeSegments.add(mutableListOf())
        routeSegments.last().add(point)
    }

    private fun isInStartupMapOnlyWindow(point: RoutePointState): Boolean {
        return ignorePointsBeforeTs > 0L &&
            point.timestamp > 0L &&
            point.timestamp < ignorePointsBeforeTs
    }

    private fun shouldAcceptStartupMapPoint(prev: RoutePointState?, next: RoutePointState): Boolean {
        val accuracy = next.accuracy ?: 999.0
        if (accuracy > 35.0) return false

        if (prev == null) return true

        val distanceM = calcDistanceMeters(prev, next)
        val prevTs = prev.timestamp
        val nextTs = next.timestamp
        val deltaSec =
            if (prevTs > 0L && nextTs > 0L) (nextTs - prevTs) / 1000.0 else 1.0

        if (distanceM > 18.0) return false
        if (deltaSec > 0.0 && distanceM / deltaSec > 5.0) return false

        return true
    }

    private fun flattenRoute(): List<RoutePointState> {
        return routeSegments.flatten()
    }

    private fun updateSplits(
        nextDistanceMeters: Double,
        nextElapsedSec: Long,
        nextElevationMeters: Double,
        nextElevationLossMeters: Double,
        nextNetElevationMeters: Double
    ) {
        val completedKm = floor(nextDistanceMeters / 1000.0).toInt()

        if (completedKm > splits.size) {
            val splitKm = splits.size + 1
            val splitDistanceKm = nextDistanceMeters / 1000.0 - lastSplitDistanceKm
            val splitTimeSec = nextElapsedSec - lastSplitElapsedSec

            val splitElevationDeltaM =
                nextNetElevationMeters - lastSplitNetElevationM
            val splitElevationGainM =
                nextElevationMeters - lastSplitElevationGainM
            val splitElevationLossM =
                nextElevationLossMeters - lastSplitElevationLossM

            if (splitDistanceKm > 0.0 && splitTimeSec > 0L) {
                splits.add(
                    RunSplitState(
                        km = splitKm,
                        avgPaceSec = splitTimeSec / splitDistanceKm,
                        cumulativeElevationGainM = nextElevationMeters,
                        elevationDeltaM = splitElevationDeltaM,
                        elevationGainM = splitElevationGainM,
                        elevationLossM = splitElevationLossM,
                    )
                )

                lastSplitDistanceKm = splitKm.toDouble()
                lastSplitElapsedSec = nextElapsedSec
                lastSplitNetElevationM = nextNetElevationMeters
                lastSplitElevationGainM = nextElevationMeters
                lastSplitElevationLossM = nextElevationLossMeters
            }
        }
    }

    private fun enqueuePendingAnnouncement(item: SpeechAnnouncementState) {
        val hasReport = !item.reportText.isNullOrBlank()
        val hasCoach = !item.coachText.isNullOrBlank()
        if (!hasReport && !hasCoach) return

        val key = item.key
        if (key != null && pendingAnnouncements.any { it.key == key }) return
        pendingAnnouncements.add(item)
    }

    private fun enqueueSpecialDistanceAnnouncement() {
        val announcement = buildSpecialDistanceAnnouncement()
        if (!announcement.shouldAnnounce || announcement.type == null) return

        when (announcement.type) {
            "halfKm" -> if (hasAnnouncedHalfKm) return
            "last500m" -> if (hasAnnouncedLast500m) return
            "final200m" -> if (hasAnnouncedFinal200m) return
            "targetReached" -> if (hasAnnouncedTargetReached) return
        }

        enqueuePendingAnnouncement(
            SpeechAnnouncementState(
                key = "special_${announcement.type}",
                reportText = announcement.reportText,
                coachText = announcement.coachText,
            )
        )

        when (announcement.type) {
            "halfKm" -> hasAnnouncedHalfKm = true
            "last500m" -> hasAnnouncedLast500m = true
            "final200m" -> hasAnnouncedFinal200m = true
            "targetReached" -> hasAnnouncedTargetReached = true
        }
    }

    private fun enqueueKmAnnouncement() {
        val announcement = buildKmAnnouncement()
        if (!announcement.shouldAnnounce) return
        if (announcement.km <= lastAnnouncedKm) return

        enqueuePendingAnnouncement(
            SpeechAnnouncementState(
                key = "km_${announcement.km}",
                reportText = announcement.reportText,
                coachText = announcement.coachText,
            )
        )

        lastAnnouncedKm = announcement.km
    }

    private fun buildSpecialDistanceAnnouncement(): SpecialAnnouncement {
        if (!hasAnnouncedHalfKm && distanceMeters / 1000.0 >= 0.5) {
            val isEarlyPhase = elapsedMs / 1000L < 180L
            val coachText = if (paceState == "가속") {
                pickRandom(
                    if (isEarlyPhase) listOf(
                        "초반 페이스가 빠른 편입니다. 한 단계만 낮춰서 호흡을 안정시키세요.",
                        "출발 흐름에서 속도가 높습니다. 리듬을 조금 정리해 보세요.",
                        "지금 초반 강도가 다소 높습니다. 호흡에 맞춰 조절해 보세요."
                    ) else listOf(
                        "지금 페이스가 조금 빠른 편입니다. 한 단계만 낮춰서 호흡을 안정시키세요.",
                        "현재 속도가 다소 높게 형성되어 있습니다. 리듬을 정리해 보세요.",
                        "지금 흐름이 약간 빠릅니다. 안정적으로 조절해 보세요."
                    )
                )
            } else {
                pickRandom(
                    if (isEarlyPhase) listOf(
                        "출발 구간입니다. 무리하지 말고 호흡을 안정시키세요.",
                        "아직 리듬을 만들어가는 구간입니다. 천천히 이어가 보세요.",
                        "지금은 몸을 풀어가는 흐름입니다. 무리하지 않도록 유지해 보세요."
                    ) else listOf(
                        "지금 페이스를 무리 없이 이어가면서 호흡을 안정시키세요.",
                        "현재 흐름을 편안하게 유지하면서 리듬을 이어가 보세요.",
                        "지금은 페이스를 부드럽게 정리하면서 흐름을 맞춰 보세요."
                    )
                )
            }

            return SpecialAnnouncement(
                shouldAnnounce = true,
                type = "halfKm",
                reportText = "500미터 지났습니다. 지금 페이스는 ${formatPaceForSpeech(if (currentPaceSec > 0) currentPaceSec else avgPaceSec)}입니다.",
                coachText = coachText,
            )
        }

        val target = targetDistanceKm
            ?: return SpecialAnnouncement(false, null, "", "")

        if (distanceMeters / 1000.0 >= target && !hasAnnouncedTargetReached) {
            return SpecialAnnouncement(true, "targetReached", "설정한 목표 지점을 통과했습니다.", "")
        }

        val remaining = target - distanceMeters / 1000.0

        if (remaining > 0.0 && remaining <= 0.2 && !hasAnnouncedFinal200m) {
            val coach = when (paceState) {
                "가속" -> pickRandom(listOf(
                    "지금 속도를 유지하되 무리하지 않게 마무리하세요.",
                    "호흡을 정리하면서 안정적으로 마무리해 보세요.",
                    "리듬을 유지하면서 끝까지 집중해 보세요."
                ))
                "감속" -> pickRandom(listOf(
                    "조금만 더 힘을 내서 리듬을 다시 살려 보세요.",
                    "끝까지 집중해서 페이스를 이어가 보세요.",
                    "마지막 힘을 모아서 밀어 보세요."
                ))
                else -> pickRandom(listOf(
                    "지금 흐름 그대로 마무리해 보세요.",
                    "끝까지 리듬을 유지해 보세요.",
                    "안정적으로 마무리해 보세요."
                ))
            }
            return SpecialAnnouncement(true, "final200m", "마지막 200미터입니다.", coach)
        }

        if (remaining > 0.2 && remaining <= 0.5 && !hasAnnouncedLast500m) {
            val coach = when (paceState) {
                "가속" -> pickRandom(listOf(
                    "페이스를 조금만 정리하면서 마무리를 준비해 보세요.",
                    "지금 속도를 살짝 낮추고 안정적으로 이어가 보세요.",
                    "호흡을 정리하면서 흐름을 유지해 보세요."
                ))
                "감속" -> pickRandom(listOf(
                    "리듬을 다시 붙여서 마무리를 준비해 보세요.",
                    "지금 흐름을 놓치지 말고 이어가 보세요.",
                    "페이스를 다시 살짝 끌어올려 보세요."
                ))
                else -> pickRandom(listOf(
                    "지금 리듬을 유지하면서 마무리에 집중해 보세요.",
                    "현재 흐름을 그대로 이어가 보세요.",
                    "안정적인 페이스로 끝까지 이어가 보세요."
                ))
            }
            return SpecialAnnouncement(true, "last500m", "마지막 500미터입니다.", coach)
        }

        return SpecialAnnouncement(false, null, "", "")
    }

    private fun buildKmAnnouncement(): KmAnnouncement {
        val completedKm = floor(distanceMeters / 1000.0).toInt()
        if (completedKm < 1) return KmAnnouncement(false, 0, "", "")
        if (completedKm <= lastAnnouncedKm) return KmAnnouncement(false, 0, "", "")

        val reportText = buildString {
            append("${completedKm}킬로미터 지났습니다. ")
            append("현재까지 ${formatDurationForSpeech(elapsedMs / 1000L)}. ")
            append("지금 페이스는 ${formatPaceForSpeech(if (currentPaceSec > 0) currentPaceSec else avgPaceSec)}. ")
            append("평균은 ${formatPaceForSpeech(avgPaceSec)}입니다.")
        }

        return KmAnnouncement(
            shouldAnnounce = true,
            km = completedKm,
            reportText = reportText,
            coachText = buildLiveAiCoachAnalysis(
                runnerType,
                runnerTrait,
                paceState,
                avgPaceLevel
            ),
        )
    }

    private fun buildLiveAiCoachAnalysis(
        runnerType: String,
        runnerTrait: String,
        paceState: String,
        avgPaceLevel: String
    ): String {
        val pool = coachingPools[runnerType]?.get(paceState)
            ?: return "현재 리듬을 유지해 보세요."

        val avgHints = avgPaceLevelHints[avgPaceLevel].orEmpty()

        repeat(5) {
            val parts = mutableListOf<String>()

            parts.add(pickRandom(pool.observation))
            parts.add(pickRandom(pool.interpretation))

            if (avgHints.isNotEmpty() && Random.nextDouble() < 0.6) {
                parts.add(pickRandom(avgHints))
            }

            if (runnerTrait != "미분류" && Random.nextDouble() < 0.35) {
                val hints = personalHints[runnerTrait]
                if (!hints.isNullOrEmpty()) {
                    parts.add(pickRandom(hints))
                }
            }

            parts.add(pickRandom(pool.action))

            val message = parts.joinToString(" ")

            if (message != lastMessageKey) {
                lastMessageKey = message
                return message
            }
        }

        val fallbackParts = mutableListOf<String>()
        fallbackParts.add(pickRandom(pool.observation))
        fallbackParts.add(pickRandom(pool.interpretation))

        if (avgHints.isNotEmpty()) {
            fallbackParts.add(pickRandom(avgHints))
        }

        if (runnerTrait != "미분류" && Random.nextDouble() < 0.35) {
            val hints = personalHints[runnerTrait]
            if (!hints.isNullOrEmpty()) {
                fallbackParts.add(pickRandom(hints))
            }
        }

        fallbackParts.add(pickRandom(pool.action))

        val fallbackMessage = fallbackParts.joinToString(" ")
        lastMessageKey = fallbackMessage
        return fallbackMessage
    }

    private fun isValidAccuracy(point: RoutePointState, elapsedSec: Int): Boolean {
        val accuracy = point.accuracy ?: return true
        return when {
            elapsedSec < 10 -> accuracy <= 45.0
            elapsedSec < 30 -> accuracy <= 50.0
            else -> accuracy <= 70.0
        }
    }

    private fun isValidMovement(prev: RoutePointState, next: RoutePointState, elapsedSec: Int): Boolean {
        val distanceM = calcDistanceMeters(prev, next)
        val prevTs = prev.timestamp
        val nextTs = next.timestamp
        val deltaSec = if (prevTs > 0L && nextTs > 0L) (nextTs - prevTs) / 1000.0 else 1.0

        val isVeryEarly = elapsedSec < 10
        val isWarmup = elapsedSec < 20

        val minDistance = if (isWarmup) 1.5 else 1.0
        val maxJumpDistance = when {
            isVeryEarly -> 18.0
            isWarmup -> 28.0
            else -> 60.0
        }
        val maxSpeedMps = when {
            isVeryEarly -> 5.0
            isWarmup -> 6.5
            else -> 8.5
        }

        if (distanceM < minDistance && deltaSec < 2.0) return false
        if (distanceM > maxJumpDistance) return false
        if (deltaSec > 0.0 && distanceM / deltaSec > maxSpeedMps) return false

        return true
    }

    private fun processElevationSegment(
        point: RoutePointState,
        segmentDistanceM: Double,
        elapsedSec: Int
    ): ElevationSegmentUpdate {
        if (elapsedSec < 20) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val pointTs = point.timestamp
        if (pointTs in 1 until ignoreElevationUntilMs) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        if (segmentDistanceM < 2.0) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val altitude = point.altitude
        if (altitude == null || !altitude.isFinite()) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        elevationSegmentDistanceAccum += segmentDistanceM
        elevationSegmentAltSamples.add(altitude)

        if (elevationSegmentDistanceAccum < 10.0) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val currentMedianAlt = getMedianAltitudeFromValues(elevationSegmentAltSamples)
            ?: run {
                elevationSegmentDistanceAccum = 0.0
                elevationSegmentAltSamples.clear()
                return ElevationSegmentUpdate(0.0, 0.0, 0.0)
            }

        val previousMedianAlt = previousElevationSegmentMedianAlt

        previousElevationSegmentMedianAlt = currentMedianAlt
        elevationSegmentDistanceAccum = 0.0
        elevationSegmentAltSamples.clear()

        if (previousMedianAlt == null) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val rawDelta = currentMedianAlt - previousMedianAlt

        // 아주 작은 변화는 무시
        if (kotlin.math.abs(rawDelta) < 0.3) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        // 비정상 큰 점프는 무시
        if (kotlin.math.abs(rawDelta) > 3.0) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        var gainApplied = 0.0
        var lossApplied = 0.0
        var netApplied = 0.0

        if (rawDelta > 0) {
            pendingElevationGainMeters += rawDelta

            while (pendingElevationGainMeters >= 1.0) {
                gainApplied += 1.0
                netApplied += 1.0
                pendingElevationGainMeters -= 1.0
            }
        } else if (rawDelta < 0) {
            pendingElevationLossMeters += -rawDelta

            while (pendingElevationLossMeters >= 1.0) {
                lossApplied += 1.0
                netApplied -= 1.0
                pendingElevationLossMeters -= 1.0
            }
        }

        return ElevationSegmentUpdate(
            gainApplied = gainApplied,
            lossApplied = lossApplied,
            netDeltaApplied = netApplied,
        )
    }

    private fun flushElevationSegmentOnStop(): ElevationSegmentUpdate {
        if (elevationSegmentAltSamples.isEmpty()) {
            elevationSegmentDistanceAccum = 0.0
            elevationSegmentAltSamples.clear()
            previousElevationSegmentMedianAlt = null
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val currentMedianAlt = getMedianAltitudeFromValues(elevationSegmentAltSamples)
        val previousMedianAlt = previousElevationSegmentMedianAlt

        // 👉 어떤 경우든 먼저 상태 정리
        elevationSegmentDistanceAccum = 0.0
        elevationSegmentAltSamples.clear()
        previousElevationSegmentMedianAlt = null

        if (currentMedianAlt == null || previousMedianAlt == null) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        val rawDelta = currentMedianAlt - previousMedianAlt

        if (kotlin.math.abs(rawDelta) < 0.3) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        if (kotlin.math.abs(rawDelta) > 3.0) {
            return ElevationSegmentUpdate(0.0, 0.0, 0.0)
        }

        var gainApplied = 0.0
        var lossApplied = 0.0
        var netApplied = 0.0

        if (rawDelta > 0) {
            pendingElevationGainMeters += rawDelta
            while (pendingElevationGainMeters >= 1.0) {
                gainApplied += 1.0
                netApplied += 1.0
                pendingElevationGainMeters -= 1.0
            }
        } else if (rawDelta < 0) {
            pendingElevationLossMeters += -rawDelta
            while (pendingElevationLossMeters >= 1.0) {
                lossApplied += 1.0
                netApplied -= 1.0
                pendingElevationLossMeters -= 1.0
            }
        }

        return ElevationSegmentUpdate(
            gainApplied = gainApplied,
            lossApplied = lossApplied,
            netDeltaApplied = netApplied,
        )
    }

    private fun getMedianAltitudeFromValues(values: List<Double>): Double? {
        val altitudes = values.filter { it.isFinite() }
        if (altitudes.size < 2) return null

        val sorted = altitudes.sorted()
        val mid = sorted.size / 2

        return if (sorted.size % 2 == 0) {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        } else {
            sorted[mid]
        }
    }

    private fun getMedianAltitude(route: List<RoutePointState>): Double? {
        val altitudes = route.mapNotNull { it.altitude }.filter { it.isFinite() }
        if (altitudes.size < 2) return null

        val sorted = altitudes.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 0) {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        } else {
            sorted[mid]
        }
    }

    data class ElevationSegmentUpdate(
        val gainApplied: Double,
        val lossApplied: Double,
        val netDeltaApplied: Double,
    )

    private fun getRecentBaselinePace(route: List<RoutePointState>, fallbackPace: Double): Double {
        if (route.size < 2) return fallbackPace

        val targetDistance = 200.0
        var dist = 0.0
        var i = route.lastIndex

        while (i > 0 && dist < targetDistance) {
            val p1 = route[i]
            val p0 = route[i - 1]
            dist += calcDistanceMeters(p0, p1)
            i--
        }

        val start = route.getOrNull(i) ?: return fallbackPace
        val end = route.lastOrNull() ?: return fallbackPace
        val startTs = start.timestamp
        val endTs = end.timestamp
        val durationSec = (endTs - startTs) / 1000.0

        if (durationSec <= 0.0 || dist <= 0.0) return fallbackPace
        return durationSec / (dist / 1000.0)
    }

    private fun calculateRecentPaceFromRoute(route: List<RoutePointState>): Double {
        val targets = listOf(20.0, 12.0, 8.0, 5.0)
        for (target in targets) {
            val pace = calculateRecentPaceByTarget(route, target)
            if (pace > 0.0) return pace
        }
        return 0.0
    }

    private fun calculateRecentPaceByTarget(route: List<RoutePointState>, targetMeters: Double): Double {
        if (route.size < 2) return 0.0

        var accumulatedMeters = 0.0
        var startIndex = route.lastIndex

        for (i in route.lastIndex downTo 1) {
            accumulatedMeters += calcDistanceMeters(route[i - 1], route[i])
            if (accumulatedMeters >= targetMeters) {
                startIndex = i - 1
                break
            }
        }

        if (accumulatedMeters < targetMeters) return 0.0

        val startPoint = route[startIndex]
        val endPoint = route.last()
        val startTs = startPoint.timestamp
        val endTs = endPoint.timestamp
        if (endTs <= startTs) return 0.0

        val elapsedSec = (endTs - startTs) / 1000.0
        val distanceKm = accumulatedMeters / 1000.0
        if (elapsedSec <= 0.0 || distanceKm <= 0.0) return 0.0

        return elapsedSec / distanceKm
    }

    private fun estimateCalories(
        weightKg: Double,
        distanceKm: Double,
        sex: String,
        heightCm: Double
    ): Double {
        if (weightKg <= 0.0 || distanceKm <= 0.0) return 0.0

        val base = weightKg * distanceKm * 1.036

        val sexFactor = when (sex) {
            "여성" -> 0.93
            else -> 1.0
        }

        val heightFactor = when {
            heightCm in 1.0..159.9 -> 0.99
            heightCm >= 180.0 -> 1.01
            else -> 1.0
        }

        return base * sexFactor * heightFactor
    }

    private fun estimateCadence(
        distanceKm: Double,
        durationSec: Double,
        strideCm: Double
    ): Double {
        if (distanceKm <= 0.0 || durationSec <= 0.0 || strideCm <= 0.0) return 0.0

        val totalDistanceCm = distanceKm * 100000.0
        val estimatedSteps = totalDistanceCm / strideCm
        val minutes = durationSec / 60.0
        if (minutes <= 0.0) return 0.0

        return estimatedSteps / minutes
    }

    private fun detectLivePaceState(
        currentPaceSec: Double,
        baselinePaceSec: Double,
        previousState: String
    ): String {
        if (!currentPaceSec.isFinite() || currentPaceSec <= 0.0 ||
            !baselinePaceSec.isFinite() || baselinePaceSec <= 0.0
        ) {
            return "안정"
        }

        val diffRatio = (currentPaceSec - baselinePaceSec) / baselinePaceSec

        return when (previousState) {
            "가속" -> when {
                diffRatio <= -0.06 -> "가속"   // 유지
                diffRatio >= 0.12 -> "감속"
                else -> "안정"
            }
            "감속" -> when {
                diffRatio >= 0.06 -> "감속"   // 유지
                diffRatio <= -0.12 -> "가속"
                else -> "안정"
            }
            else -> when {
                diffRatio <= -0.12 -> "가속"
                diffRatio >= 0.12 -> "감속"
                else -> "안정"
            }
        }
    }

    private fun detectAvgPaceLevel(
        currentPaceSec: Double,
        avgPaceSec: Double
    ): String {
        if (!currentPaceSec.isFinite() || currentPaceSec <= 0.0 ||
            !avgPaceSec.isFinite() || avgPaceSec <= 0.0
        ) {
            return "보통"
        }

        val diffRatio = (currentPaceSec - avgPaceSec) / avgPaceSec

        return when {
            diffRatio <= -0.10 -> "빠름"
            diffRatio >= 0.10 -> "느림"
            else -> "보통"
        }
    }

    private fun calcDistanceMeters(a: RoutePointState, b: RoutePointState): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(b.latitude - a.latitude)
        val dLon = Math.toRadians(b.longitude - a.longitude)
        val lat1 = Math.toRadians(a.latitude)
        val lat2 = Math.toRadians(b.latitude)

        val x = sin(dLat / 2).pow(2) + sin(dLon / 2).pow(2) * cos(lat1) * cos(lat2)
        return r * 2.0 * atan2(sqrt(x), sqrt(1.0 - x))
    }

    private fun formatDurationForSpeech(sec: Long): String {
        val h = floor(sec / 3600.0).toInt()
        val m = floor((sec % 3600) / 60.0).toInt()
        val s = floor(sec % 60.0).toInt()
        return if (h > 0) "${h}시간 ${m}분 ${s}초" else "${m}분 ${s}초"
    }

    private fun formatPaceForSpeech(sec: Double): String {
        if (!sec.isFinite() || sec <= 0.0) return "측정 중"
        val m = floor(sec / 60.0).toInt()
        val s = floor(sec % 60.0).toInt()
        return "${m}분 ${s}초"
    }

    private fun <T> pickRandom(items: List<T>): T {
        return items[Random.nextInt(items.size)]
    }
}
