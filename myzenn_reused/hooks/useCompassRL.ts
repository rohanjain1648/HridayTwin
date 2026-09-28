/**
 * useCompassRL — MyCompass Reinforcement Learning Hook
 * 
 * The central hook that drives the MyCompass contextual bandit agent.
 * It:
 *  1. Extracts a rich context vector from user state (time, emotion, history)
 *  2. Recommends the best therapy tool via Thompson Sampling
 *  3. Collects pre/post session reward signals
 *  4. Updates the bandit model and persists it to localStorage
 * 
 * All computation is fully on-device — no network calls for the RL core.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { sanctuaryTools, SanctuaryTool } from '@/data/sanctuaryTools';
import {
    BanditState,
    initBandit,
    recommend,
    update,
    serializeBandit,
    deserializeBandit,
    getArmStats,
} from '@/lib/rl/LinUCB';

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mycompass_bandit_state';
const CONTEXT_DIM = 12; // see buildContextVector below
const LAMBDA = 1.5;
const SIGMA = 0.6;

/** Tools that should never be recommended by the RL agent (meta-tools). */
const EXCLUDED_ARMS = new Set(['my-quest', 'vr-sanctuary', 'wellness-resources', 'my-spaces']);

const ARM_IDS = sanctuaryTools
    .filter(t => !EXCLUDED_ARMS.has(t.id))
    .map(t => t.id);

// ─── Context Features ────────────────────────────────────────────────────────

/**
 * Build a normalised context vector X_t (dim = CONTEXT_DIM).
 *
 * Features:
 * [0]  sin(time_of_day)         — cyclical encoding
 * [1]  cos(time_of_day)
 * [2]  sin(day_of_week)
 * [3]  cos(day_of_week)
 * [4]  valence                  — emotion: -1 (neg) to +1 (pos)
 * [5]  arousal                  — emotion: 0 (calm) to +1 (excited)
 * [6]  stress_proxy             — 0-1
 * [7]  sessions_today           — normalised (÷5)
 * [8]  days_since_last_session  — decay (e^(-d/3))
 * [9]  recent_completion_rate   — 0-1
 * [10] last_session_mood_delta  — -1 to +1
 * [11] bias                     — always 1
 */
function buildContextVector(ctx: RawContext): number[] {
    const hour = ctx.hourOfDay / 23;
    const dayFrac = ctx.dayOfWeek / 6;

    return [
        Math.sin(2 * Math.PI * hour),
        Math.cos(2 * Math.PI * hour),
        Math.sin(2 * Math.PI * dayFrac),
        Math.cos(2 * Math.PI * dayFrac),
        Math.max(-1, Math.min(1, ctx.valence ?? 0)),
        Math.max(0, Math.min(1, ctx.arousal ?? 0.5)),
        Math.max(0, Math.min(1, ctx.stressProxy ?? 0.5)),
        Math.min(1, (ctx.sessionsToday ?? 0) / 5),
        Math.exp(-Math.max(0, ctx.daysSinceLastSession ?? 0) / 3),
        Math.max(0, Math.min(1, ctx.recentCompletionRate ?? 0.5)),
        Math.max(-1, Math.min(1, ctx.lastMoodDelta ?? 0)),
        1.0, // bias
    ];
}

interface RawContext {
    hourOfDay: number;
    dayOfWeek: number;          // 0=Sunday, 6=Saturday
    valence?: number;           // from MyMirror / manual check-in
    arousal?: number;
    stressProxy?: number;
    sessionsToday?: number;
    daysSinceLastSession?: number;
    recentCompletionRate?: number;
    lastMoodDelta?: number;
}

// ─── Session History (localStorage) ─────────────────────────────────────────

interface SessionEntry {
    toolId: string;
    timestamp: number;
    preMood: number;
    postMood: number;
    completed: boolean;
    moodDelta: number;
}

const HISTORY_KEY = 'mycompass_session_history';
const MAX_HISTORY = 50;

function loadHistory(): SessionEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveHistory(entries: SessionEntry[]) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_HISTORY)));
}

// ─── Reasoning Generator ─────────────────────────────────────────────────────

function generateReasoning(
    tool: SanctuaryTool,
    state: BanditState,
    ctx: RawContext,
    history: SessionEntry[]
): string {
    const stats = getArmStats(state, tool.id);
    const recentSuccesses = history
        .filter(h => h.toolId === tool.id && h.moodDelta > 0)
        .slice(-3);

    const now = new Date();
    const hourLabel =
        ctx.hourOfDay < 12 ? 'morning' :
            ctx.hourOfDay < 17 ? 'afternoon' :
                ctx.hourOfDay < 21 ? 'evening' : 'night';

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[ctx.dayOfWeek];

    if (stats && stats.pulls === 0) {
        return `I haven't seen you try ${tool.title} yet — let's explore it together.`;
    }

    if (recentSuccesses.length >= 2) {
        const avgDelta = recentSuccesses.reduce((s, h) => s + h.moodDelta, 0) / recentSuccesses.length;
        const pct = Math.round(avgDelta * 10); // mood is 1-10 scale
        return `Your last ${recentSuccesses.length} sessions with ${tool.title} improved your mood by ~${pct}% — especially on ${dayName} ${hourLabel}s.`;
    }

    if (stats && stats.avgReward > 0.4) {
        return `Based on your history, ${tool.title} tends to work well for you at this time of ${hourLabel}.`;
    }

    if (ctx.stressProxy && ctx.stressProxy > 0.6) {
        return `You seem a bit stressed right now — ${tool.title} is one of your best tools for these moments.`;
    }

    return `My model suggests ${tool.title} is a strong match for your current emotional state.`;
}

// ─── Reward Computation ──────────────────────────────────────────────────────

function computeReward(preMood: number, postMood: number, completed: boolean): number {
    const delta = (postMood - preMood) / 9; // normalise to -1..1
    const completionBonus = completed ? 0.2 : -0.1;
    const clampedReward = Math.max(-1, Math.min(1, delta + completionBonus));
    return clampedReward;
}

// ─── Main Hook ───────────────────────────────────────────────────────────────

export interface CompassRecommendation {
    tool: SanctuaryTool;
    confidence: number;          // 0-100
    reasoning: string;
    isExploring: boolean;        // true = exploration, false = exploitation
}

export interface UseCompassRLReturn {
    /** Current recommendation from the RL agent. */
    recommendation: CompassRecommendation | null;
    /** Whether the agent has enough data to be meaningful. */
    isWarmedUp: boolean;
    /** Total training rounds completed. */
    totalRounds: number;
    /** Refresh recommendation with latest context. */
    refresh: () => void;
    /** Call when user accepts recommendation and starts session. */
    onSessionStart: (preMood: number) => void;
    /** Call when session ends with outcome. */
    onSessionEnd: (postMood: number, completed: boolean) => void;
    /** Signal rejection (negative signal). */
    onReject: () => void;
    /** Get per-tool stats. */
    getToolStats: (toolId: string) => { pulls: number; avgReward: number } | null;
    /** Session history for display. */
    sessionHistory: SessionEntry[];
}

interface ActiveSession {
    toolId: string;
    contextVector: number[];
    preMood: number;
    startedAt: number;
}

export function useCompassRL(externalContext?: Partial<RawContext>): UseCompassRLReturn {
    const [banditState, setBanditState] = useState<BanditState>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return deserializeBandit(stored);
        } catch { /* ignore */ }
        return initBandit({ contextDim: CONTEXT_DIM, lambda: LAMBDA, sigma: SIGMA, arms: ARM_IDS });
    });

    const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>(() => loadHistory());
    const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
    const [recommendation, setRecommendation] = useState<CompassRecommendation | null>(null);

    // Persist state on change
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, serializeBandit(banditState));
        } catch { /* storage full – silently fail */ }
    }, [banditState]);

    // Build raw context from current time + external signals
    const buildRawContext = useCallback((): RawContext => {
        const now = new Date();
        const history = loadHistory();

        const today = history.filter(h => {
            const d = new Date(h.timestamp);
            return d.toDateString() === now.toDateString();
        });

        const lastEntry = history[history.length - 1];
        const daysSinceLast = lastEntry
            ? (Date.now() - lastEntry.timestamp) / (1000 * 60 * 60 * 24)
            : 7;

        const recent10 = history.slice(-10);
        const completionRate = recent10.length
            ? recent10.filter(h => h.completed).length / recent10.length
            : 0.5;

        const lastDelta = lastEntry ? lastEntry.moodDelta : 0;

        return {
            hourOfDay: now.getHours(),
            dayOfWeek: now.getDay(),
            sessionsToday: today.length,
            daysSinceLastSession: daysSinceLast,
            recentCompletionRate: completionRate,
            lastMoodDelta: lastDelta / 9, // normalise
            ...externalContext,
        };
    }, [externalContext]);

    const refresh = useCallback(() => {
        const ctx = buildRawContext();
        const vector = buildContextVector(ctx);
        const { armId, confidence } = recommend(banditState, vector);
        const tool = sanctuaryTools.find(t => t.id === armId);
        if (!tool) return;

        const reasoning = generateReasoning(tool, banditState, ctx, sessionHistory);
        const arm = banditState.arms[armId];
        const isExploring = arm.pulls < 3 || confidence < 50;

        setRecommendation({ tool, confidence, reasoning, isExploring });
    }, [banditState, buildRawContext, sessionHistory]);

    // Initial recommendation on mount
    useEffect(() => {
        refresh();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const onSessionStart = useCallback((preMood: number) => {
        if (!recommendation) return;
        const ctx = buildRawContext();
        const vector = buildContextVector(ctx);
        setActiveSession({
            toolId: recommendation.tool.id,
            contextVector: vector,
            preMood,
            startedAt: Date.now(),
        });
    }, [recommendation, buildRawContext]);

    const onSessionEnd = useCallback((postMood: number, completed: boolean) => {
        if (!activeSession) return;

        const reward = computeReward(activeSession.preMood, postMood, completed);
        const newState = update(banditState, activeSession.toolId, activeSession.contextVector, reward);
        setBanditState(newState);

        const entry: SessionEntry = {
            toolId: activeSession.toolId,
            timestamp: Date.now(),
            preMood: activeSession.preMood,
            postMood,
            completed,
            moodDelta: postMood - activeSession.preMood,
        };

        const newHistory = [...sessionHistory, entry];
        setSessionHistory(newHistory);
        saveHistory(newHistory);
        setActiveSession(null);

        // Refresh recommendation after learning
        setTimeout(refresh, 100);
    }, [activeSession, banditState, sessionHistory, refresh]);

    const onReject = useCallback(() => {
        if (!recommendation) return;
        // Small negative reward for rejection
        const ctx = buildRawContext();
        const vector = buildContextVector(ctx);
        const newState = update(banditState, recommendation.tool.id, vector, -0.3);
        setBanditState(newState);
        setTimeout(refresh, 100);
    }, [recommendation, banditState, buildRawContext, refresh]);

    const getToolStats = useCallback((toolId: string) => {
        const stats = getArmStats(banditState, toolId);
        if (!stats) return null;
        return { pulls: stats.pulls, avgReward: stats.avgReward };
    }, [banditState]);

    const isWarmedUp = banditState.totalRounds >= 5;

    return {
        recommendation,
        isWarmedUp,
        totalRounds: banditState.totalRounds,
        refresh,
        onSessionStart,
        onSessionEnd,
        onReject,
        getToolStats,
        sessionHistory,
    };
}
