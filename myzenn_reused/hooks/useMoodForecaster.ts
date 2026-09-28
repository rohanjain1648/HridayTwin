/**
 * useMoodForecaster.ts — MyOracle Core Forecasting Engine
 * 
 * On-device LSTM deep learning model that predicts emotional state 24-72 hours ahead.
 * Uses TF.js for in-browser inference. No data leaves the device.
 * 
 * Data pipeline: mood check-ins + emotion journal + session data + temporal features + weather
 * Model: 2-layer LSTM (32→16) → Dense(3) for 24/48/72h mood predictions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import { getWeatherForecast, getWeatherAtTime, type WeatherForecast } from '@/services/weatherService';
import { sanctuaryTools } from '@/data/sanctuaryTools';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────────────

export interface MoodDataPoint {
    id: string;
    timestamp: string;
    moodScore: number;           // 1-10
    emotionLabel: string;        // e.g. 'happy', 'anxious', 'neutral'
    sessionCount: number;        // sessions completed that day
    sleepGapHours: number;       // proxy: hours between last and first app usage
    dayOfWeek: number;           // 0-6
    hourOfDay: number;           // 0-23
    isWeekend: boolean;
    temperature: number;
    humidity: number;
    cloudCover: number;
    precipProbability: number;
    source: 'check-in' | 'auto' | 'journal';
    note?: string;
}

export interface MoodPrediction {
    horizon: '24h' | '48h' | '72h';
    score: number;               // predicted mood 1-10
    label: string;               // human-readable
    confidence: number;          // 0-1
    timestamp: string;           // when this prediction is for
}

export interface OracleInsight {
    id: string;
    type: 'warning' | 'pattern' | 'recommendation' | 'positive';
    title: string;
    description: string;
    urgency: 'low' | 'medium' | 'high';
    suggestedTool?: string;      // sanctuary tool id
    suggestedTime?: string;
}

export interface WeeklyForecast {
    overallTrend: 'improving' | 'stable' | 'declining';
    averagePredictedMood: number;
    predictions: MoodPrediction[];
    insights: OracleInsight[];
    generatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const TIMESERIES_KEY = 'myzen_oracle_timeseries';
const MODEL_KEY = 'localstorage://myzen-oracle-lstm';
const NOTIFICATION_KEY = 'myzen_oracle_notifications';
const SEQUENCE_LENGTH = 7;    // look-back window
const NUM_FEATURES = 10;      // feature count per data point
const MIN_DATA_POINTS = 14;   // minimum for training
const MOOD_DIP_THRESHOLD = 4; // score below which we alert
const MAX_DATA_POINTS = 500;  // cap stored data

// Emotion label → numeric encoding
const EMOTION_SCORES: Record<string, number> = {
    'happy': 9, 'joyful': 9, 'excited': 8, 'content': 8,
    'calm': 7, 'peaceful': 7, 'relaxed': 7, 'neutral': 5,
    'bored': 4, 'tired': 4, 'sad': 3, 'anxious': 3,
    'stressed': 3, 'angry': 2, 'fearful': 2, 'disgusted': 2,
    'depressed': 1, 'overwhelmed': 2, 'unknown': 5,
};

// Mood score → human label
function getMoodLabel(score: number): string {
    if (score >= 8) return 'Great';
    if (score >= 6.5) return 'Good';
    if (score >= 5) return 'Okay';
    if (score >= 3.5) return 'Low';
    if (score >= 2) return 'Difficult';
    return 'Critical';
}

function getMoodColor(score: number): string {
    if (score >= 8) return '#10b981';   // emerald
    if (score >= 6.5) return '#06b6d4'; // cyan
    if (score >= 5) return '#8b5cf6';   // violet
    if (score >= 3.5) return '#f59e0b'; // amber
    if (score >= 2) return '#ef4444';   // red
    return '#dc2626';                   // deep red
}

// ─── Feature Extraction ──────────────────────────────────────────────

function extractFeatures(dp: MoodDataPoint): number[] {
    return [
        dp.moodScore / 10,
        (EMOTION_SCORES[dp.emotionLabel] || 5) / 10,
        Math.min(dp.sessionCount, 10) / 10,
        Math.min(dp.sleepGapHours, 12) / 12,
        dp.dayOfWeek / 6,
        dp.hourOfDay / 23,
        dp.isWeekend ? 1 : 0,
        (dp.temperature + 10) / 60,   // normalize roughly -10 to 50°C
        dp.humidity / 100,
        dp.cloudCover / 100,
    ];
}

// ─── Model Builder ───────────────────────────────────────────────────

function buildModel(): tf.Sequential {
    const model = tf.sequential();

    model.add(tf.layers.lstm({
        units: 32,
        inputShape: [SEQUENCE_LENGTH, NUM_FEATURES],
        returnSequences: true,
        dropout: 0.1,
        recurrentDropout: 0.1,
    }));

    model.add(tf.layers.lstm({
        units: 16,
        returnSequences: false,
        dropout: 0.1,
    }));

    model.add(tf.layers.dense({
        units: 8,
        activation: 'relu',
    }));

    model.add(tf.layers.dense({
        units: 3,        // 24h, 48h, 72h predictions
        activation: 'sigmoid',  // output 0-1, scale back to 1-10
    }));

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['mae'],
    });

    return model;
}

// ─── Training Data Preparation ───────────────────────────────────────

function prepareSlidingWindowData(data: MoodDataPoint[]): {
    xs: number[][][];
    ys: number[][];
} {
    const xs: number[][][] = [];
    const ys: number[][] = [];

    // Sort by timestamp
    const sorted = [...data].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Create sliding windows
    for (let i = 0; i <= sorted.length - SEQUENCE_LENGTH - 3; i++) {
        const window = sorted.slice(i, i + SEQUENCE_LENGTH);
        const targets = sorted.slice(i + SEQUENCE_LENGTH, i + SEQUENCE_LENGTH + 3);

        if (targets.length < 3) continue;

        xs.push(window.map(extractFeatures));
        ys.push(targets.map(t => t.moodScore / 10)); // normalize to 0-1
    }

    return { xs, ys };
}

// ─── Insight Generator ───────────────────────────────────────────────

function generateInsights(
    predictions: MoodPrediction[],
    timeSeries: MoodDataPoint[]
): OracleInsight[] {
    const insights: OracleInsight[] = [];

    // 1. Check for predicted dips
    for (const pred of predictions) {
        if (pred.score < MOOD_DIP_THRESHOLD) {
            const horizonLabel = pred.horizon === '24h' ? 'tomorrow' : pred.horizon === '48h' ? 'in two days' : 'in three days';
            insights.push({
                id: `dip-${pred.horizon}`,
                type: 'warning',
                title: `Mood dip predicted ${horizonLabel}`,
                description: `Your predicted mood score is ${pred.score.toFixed(1)}/10 — consider scheduling a wellness session beforehand.`,
                urgency: pred.score < 3 ? 'high' : 'medium',
                suggestedTool: 'live-meditation',
                suggestedTime: pred.timestamp,
            });
        }
    }

    // 2. Day-of-week patterns
    if (timeSeries.length >= 14) {
        const dayScores: Record<number, number[]> = {};
        for (const dp of timeSeries) {
            const day = dp.dayOfWeek;
            if (!dayScores[day]) dayScores[day] = [];
            dayScores[day].push(dp.moodScore);
        }

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let worstDay = -1;
        let worstAvg = 10;
        let bestDay = -1;
        let bestAvg = 0;

        for (const [day, scores] of Object.entries(dayScores)) {
            if (scores.length >= 2) {
                const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                if (avg < worstAvg) { worstAvg = avg; worstDay = parseInt(day); }
                if (avg > bestAvg) { bestAvg = avg; bestDay = parseInt(day); }
            }
        }

        if (worstDay >= 0 && worstAvg < 5) {
            insights.push({
                id: 'pattern-worst-day',
                type: 'pattern',
                title: `${dayNames[worstDay]}s tend to be harder`,
                description: `Your average mood on ${dayNames[worstDay]}s is ${worstAvg.toFixed(1)}/10. Consider a proactive wellness routine.`,
                urgency: 'medium',
                suggestedTool: 'box-breathing',
            });
        }

        if (bestDay >= 0 && bestAvg > 7) {
            insights.push({
                id: 'pattern-best-day',
                type: 'positive',
                title: `${dayNames[bestDay]}s are your best days!`,
                description: `You average ${bestAvg.toFixed(1)}/10 on ${dayNames[bestDay]}s. What's your secret?`,
                urgency: 'low',
            });
        }
    }

    // 3. Time-of-day patterns
    if (timeSeries.length >= 14) {
        const morningScores = timeSeries.filter(d => {
            const h = new Date(d.timestamp).getHours();
            return h >= 6 && h < 12;
        }).map(d => d.moodScore);

        const eveningScores = timeSeries.filter(d => {
            const h = new Date(d.timestamp).getHours();
            return h >= 18 && h < 24;
        }).map(d => d.moodScore);

        if (morningScores.length >= 3) {
            const morningAvg = morningScores.reduce((a, b) => a + b, 0) / morningScores.length;
            if (morningAvg < 4.5) {
                insights.push({
                    id: 'pattern-morning',
                    type: 'pattern',
                    title: 'Mornings can be rough',
                    description: `Your morning mood averages ${morningAvg.toFixed(1)}/10. A morning routine with MyBreath could help.`,
                    urgency: 'medium',
                    suggestedTool: 'box-breathing',
                });
            }
        }

        if (eveningScores.length >= 3) {
            const eveningAvg = eveningScores.reduce((a, b) => a + b, 0) / eveningScores.length;
            if (eveningAvg < 4.5) {
                insights.push({
                    id: 'pattern-evening',
                    type: 'pattern',
                    title: 'Evenings tend to dip',
                    description: `Evening mood averages ${eveningAvg.toFixed(1)}/10. Try scheduling MyPeace before dinner.`,
                    urgency: 'medium',
                    suggestedTool: 'live-meditation',
                });
            }
        }
    }

    // 4. Overall trend
    if (predictions.length > 0) {
        const avgPrediction = predictions.reduce((a, b) => a + b.score, 0) / predictions.length;
        if (avgPrediction >= 7) {
            insights.push({
                id: 'trend-positive',
                type: 'positive',
                title: 'Looking good ahead!',
                description: 'Your forecast shows positive emotional energy. Keep doing what you\'re doing!',
                urgency: 'low',
            });
        }
    }

    // 5. Sleep proxy insight
    if (timeSeries.length >= 7) {
        const recentSleep = timeSeries.slice(-7).map(d => d.sleepGapHours);
        const avgSleep = recentSleep.reduce((a, b) => a + b, 0) / recentSleep.length;
        if (avgSleep < 5) {
            insights.push({
                id: 'sleep-low',
                type: 'warning',
                title: 'Sleep patterns look short',
                description: `Your estimated rest gaps average ${avgSleep.toFixed(1)} hours. Better rest could significantly improve your mood.`,
                urgency: 'high',
            });
        }
    }

    return insights.slice(0, 6); // cap at 6 insights
}

// ─── Proactive Notifications ─────────────────────────────────────────

function checkAndNotify(predictions: MoodPrediction[]): void {
    try {
        const notified = JSON.parse(localStorage.getItem(NOTIFICATION_KEY) || '{}');
        const today = new Date().toISOString().split('T')[0];

        for (const pred of predictions) {
            const key = `${today}-${pred.horizon}`;
            if (notified[key]) continue;

            if (pred.score < MOOD_DIP_THRESHOLD) {
                const horizonLabel = pred.horizon === '24h' ? 'Tomorrow' : pred.horizon === '48h' ? 'In 2 days' : 'In 3 days';
                toast.warning(`🔮 ${horizonLabel}: mood dip predicted`, {
                    description: `Score: ${pred.score.toFixed(1)}/10 — Consider a proactive session now.`,
                    duration: 8000,
                    action: {
                        label: 'MyPeace',
                        onClick: () => window.location.href = '/mysanctuary/mypeace',
                    },
                });
                notified[key] = true;
            }
        }

        // Keep only today's notifications in storage
        const cleaned: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(notified)) {
            if (k.startsWith(today)) cleaned[k] = v as boolean;
        }
        localStorage.setItem(NOTIFICATION_KEY, JSON.stringify(cleaned));
    } catch (e) {
        console.warn('[Oracle] Notification check failed:', e);
    }
}

// ─── Main Hook ───────────────────────────────────────────────────────

export function useMoodForecaster() {
    const [timeSeries, setTimeSeries] = useState<MoodDataPoint[]>([]);
    const [predictions, setPredictions] = useState<MoodPrediction[]>([]);
    const [insights, setInsights] = useState<OracleInsight[]>([]);
    const [isModelReady, setIsModelReady] = useState(false);
    const [isTraining, setIsTraining] = useState(false);
    const [modelAccuracy, setModelAccuracy] = useState<number | null>(null);
    const [weather, setWeather] = useState<WeatherForecast | null>(null);

    const modelRef = useRef<tf.Sequential | null>(null);
    const initRef = useRef(false);

    // ─── Load stored timeseries ────────────────────────────────────────
    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        try {
            const stored = localStorage.getItem(TIMESERIES_KEY);
            if (stored) {
                const parsed: MoodDataPoint[] = JSON.parse(stored);
                setTimeSeries(parsed.slice(-MAX_DATA_POINTS));
            }
        } catch (e) {
            console.error('[Oracle] Failed to load timeseries:', e);
        }

        // Load weather
        getWeatherForecast().then(setWeather).catch(console.error);
    }, []);

    // ─── Persist timeseries ────────────────────────────────────────────
    useEffect(() => {
        if (timeSeries.length === 0) return;
        try {
            localStorage.setItem(TIMESERIES_KEY, JSON.stringify(timeSeries.slice(-MAX_DATA_POINTS)));
        } catch (e) {
            console.error('[Oracle] Failed to persist timeseries:', e);
        }
    }, [timeSeries]);

    // ─── Initialize / Load Model ──────────────────────────────────────
    useEffect(() => {
        async function initModel() {
            try {
                // Try loading saved model
                const loaded = await tf.loadLayersModel(MODEL_KEY);
                modelRef.current = loaded as tf.Sequential;
                setIsModelReady(true);
                console.log('[Oracle] Model loaded from localStorage');
            } catch {
                // Build fresh model
                modelRef.current = buildModel();
                setIsModelReady(true);
                console.log('[Oracle] Fresh model built');
            }
        }
        initModel();

        return () => {
            modelRef.current?.dispose();
        };
    }, []);

    // ─── Run Prediction ────────────────────────────────────────────────
    useEffect(() => {
        if (!isModelReady || !modelRef.current || timeSeries.length < SEQUENCE_LENGTH) return;

        const sorted = [...timeSeries].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const latest = sorted.slice(-SEQUENCE_LENGTH);
        const features = latest.map(extractFeatures);

        try {
            const inputTensor = tf.tensor3d([features], [1, SEQUENCE_LENGTH, NUM_FEATURES]);
            const output = modelRef.current.predict(inputTensor) as tf.Tensor;
            const values = output.dataSync();

            const now = Date.now();
            const newPredictions: MoodPrediction[] = [
                {
                    horizon: '24h',
                    score: Math.max(1, Math.min(10, values[0] * 10)),
                    label: getMoodLabel(values[0] * 10),
                    confidence: timeSeries.length >= MIN_DATA_POINTS ? 0.6 + Math.min(0.3, timeSeries.length / 200) : 0.3,
                    timestamp: new Date(now + 24 * 3600000).toISOString(),
                },
                {
                    horizon: '48h',
                    score: Math.max(1, Math.min(10, values[1] * 10)),
                    label: getMoodLabel(values[1] * 10),
                    confidence: timeSeries.length >= MIN_DATA_POINTS ? 0.5 + Math.min(0.25, timeSeries.length / 250) : 0.25,
                    timestamp: new Date(now + 48 * 3600000).toISOString(),
                },
                {
                    horizon: '72h',
                    score: Math.max(1, Math.min(10, values[2] * 10)),
                    label: getMoodLabel(values[2] * 10),
                    confidence: timeSeries.length >= MIN_DATA_POINTS ? 0.4 + Math.min(0.2, timeSeries.length / 300) : 0.2,
                    timestamp: new Date(now + 72 * 3600000).toISOString(),
                },
            ];

            setPredictions(newPredictions);
            setInsights(generateInsights(newPredictions, timeSeries));
            checkAndNotify(newPredictions);

            inputTensor.dispose();
            output.dispose();
        } catch (err) {
            console.error('[Oracle] Prediction failed:', err);
        }
    }, [isModelReady, timeSeries]);

    // ─── Add Mood Check-In ─────────────────────────────────────────────
    const addMoodCheckIn = useCallback((score: number, note?: string) => {
        const now = new Date();
        const weatherFeatures = weather
            ? getWeatherAtTime(weather, now)
            : { temperature: 22, humidity: 50, cloudCover: 30, precipProbability: 10 };

        // Calculate sleep gap proxy
        const sorted = [...timeSeries].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const lastEntry = sorted[0];
        let sleepGap = 7; // default
        if (lastEntry) {
            const gap = (now.getTime() - new Date(lastEntry.timestamp).getTime()) / 3600000;
            if (gap > 4 && gap < 14) sleepGap = gap; // reasonable sleep gap
        }

        // Count today's sessions (rough proxy from timeseries)
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayEntries = timeSeries.filter(d => new Date(d.timestamp) >= todayStart);

        const newPoint: MoodDataPoint = {
            id: crypto.randomUUID(),
            timestamp: now.toISOString(),
            moodScore: Math.max(1, Math.min(10, score)),
            emotionLabel: score >= 7 ? 'content' : score >= 5 ? 'neutral' : score >= 3 ? 'anxious' : 'stressed',
            sessionCount: todayEntries.length,
            sleepGapHours: sleepGap,
            dayOfWeek: now.getDay(),
            hourOfDay: now.getHours(),
            isWeekend: now.getDay() === 0 || now.getDay() === 6,
            temperature: weatherFeatures.temperature,
            humidity: weatherFeatures.humidity,
            cloudCover: weatherFeatures.cloudCover,
            precipProbability: weatherFeatures.precipProbability,
            source: 'check-in',
            note,
        };

        setTimeSeries(prev => [...prev, newPoint].slice(-MAX_DATA_POINTS));

        toast.success('Mood recorded', {
            description: `Score: ${score}/10 — ${getMoodLabel(score)}`,
            duration: 3000,
        });
    }, [timeSeries, weather]);

    // ─── Retrain Model ─────────────────────────────────────────────────
    const retrainModel = useCallback(async () => {
        if (!modelRef.current || timeSeries.length < MIN_DATA_POINTS) {
            toast.error('Need more data', {
                description: `Collect at least ${MIN_DATA_POINTS} data points to train. You have ${timeSeries.length}.`,
            });
            return;
        }

        setIsTraining(true);

        try {
            const { xs, ys } = prepareSlidingWindowData(timeSeries);

            if (xs.length < 3) {
                toast.error('Not enough training sequences', {
                    description: 'Keep checking in daily to build more training data.',
                });
                setIsTraining(false);
                return;
            }

            const xTensor = tf.tensor3d(xs);
            const yTensor = tf.tensor2d(ys);

            const result = await modelRef.current.fit(xTensor, yTensor, {
                epochs: 20,
                batchSize: Math.min(8, xs.length),
                validationSplit: 0.2,
                shuffle: true,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        if (epoch % 5 === 0) {
                            console.log(`[Oracle] Epoch ${epoch}: loss=${logs?.loss?.toFixed(4)}, mae=${logs?.mae?.toFixed(4)}`);
                        }
                    },
                },
            });

            // Extract accuracy (1 - MAE as approximation)
            const finalMAE = result.history.mae?.[result.history.mae.length - 1];
            if (typeof finalMAE === 'number') {
                setModelAccuracy(Math.max(0, 1 - finalMAE));
            }

            // Save trained model
            await modelRef.current.save(MODEL_KEY);
            console.log('[Oracle] Model saved to localStorage');

            toast.success('Model retrained!', {
                description: `Trained on ${xs.length} sequences with ${timeSeries.length} data points.`,
            });

            xTensor.dispose();
            yTensor.dispose();
        } catch (err) {
            console.error('[Oracle] Training failed:', err);
            toast.error('Training failed', { description: 'Try again later.' });
        } finally {
            setIsTraining(false);
        }
    }, [timeSeries]);

    // ─── Weekly Forecast ───────────────────────────────────────────────
    const weeklyForecast: WeeklyForecast = {
        overallTrend: predictions.length >= 2
            ? predictions[predictions.length - 1].score > predictions[0].score
                ? 'improving'
                : predictions[predictions.length - 1].score < predictions[0].score - 0.5
                    ? 'declining'
                    : 'stable'
            : 'stable',
        averagePredictedMood: predictions.length > 0
            ? predictions.reduce((a, b) => a + b.score, 0) / predictions.length
            : 5,
        predictions,
        insights,
        generatedAt: new Date().toISOString(),
    };

    // ─── Recommended Tools ─────────────────────────────────────────────
    const getRecommendedTools = useCallback(() => {
        const avgPredicted = predictions.length > 0
            ? predictions.reduce((a, b) => a + b.score, 0) / predictions.length
            : 5;

        const toolIds = avgPredicted < 4
            ? ['box-breathing', 'live-meditation', 'body-scan']
            : avgPredicted < 6
                ? ['live-meditation', 'zen-particles', 'my-flow']
                : ['zen-particles', 'yoga-flow', 'my-spaces'];

        return toolIds
            .map(id => sanctuaryTools.find(t => t.id === id))
            .filter(Boolean);
    }, [predictions]);

    return {
        // Data
        timeSeries,
        predictions,
        insights,
        weeklyForecast,
        weather,

        // State
        isModelReady,
        isTraining,
        dataPointCount: timeSeries.length,
        modelAccuracy,
        minDataPoints: MIN_DATA_POINTS,

        // Actions
        addMoodCheckIn,
        retrainModel,
        getRecommendedTools,
        getMoodLabel,
        getMoodColor,
    };
}
