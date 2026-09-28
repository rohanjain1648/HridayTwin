/**
 * PredictiveChart.tsx — Time-Series Mood Visualization with Forecast Overlay
 * 
 * Historical mood as solid line, predicted future as dashed line + confidence band.
 * Uses Recharts. Day-of-week heatmap below main chart.
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
} from 'recharts';
import { Calendar, TrendingUp, Clock } from 'lucide-react';
import type { MoodDataPoint, MoodPrediction } from '@/hooks/useMoodForecaster';
import { getWeatherEmoji } from '@/services/weatherService';

// ─── Types ───────────────────────────────────────────────────────────

interface PredictiveChartProps {
    timeSeries: MoodDataPoint[];
    predictions: MoodPrediction[];
    getMoodColor: (score: number) => string;
}

type TimeRange = '7d' | '14d' | '30d';

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────

export default function PredictiveChart({
    timeSeries,
    predictions,
    getMoodColor,
}: PredictiveChartProps) {
    const [timeRange, setTimeRange] = useState<TimeRange>('14d');

    // ─── Filter data by range ──────────────────────────────────────────
    const filteredData = useMemo(() => {
        const now = Date.now();
        const rangeMs = timeRange === '7d' ? 7 * 86400000 : timeRange === '14d' ? 14 * 86400000 : 30 * 86400000;
        const cutoff = now - rangeMs;

        const sorted = [...timeSeries]
            .filter(d => new Date(d.timestamp).getTime() >= cutoff)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return sorted;
    }, [timeSeries, timeRange]);

    // ─── Build chart data ──────────────────────────────────────────────
    const chartData = useMemo(() => {
        // Historical points
        const historical = filteredData.map(d => ({
            time: new Date(d.timestamp).getTime(),
            label: formatDateShort(d.timestamp),
            fullLabel: formatDateFull(d.timestamp),
            mood: d.moodScore,
            predicted: null as number | null,
            upper: null as number | null,
            lower: null as number | null,
            weather: getWeatherEmoji(0), // simplified
            temperature: d.temperature,
            type: 'historical' as const,
        }));

        // Prediction points
        const forecastPoints = predictions.map(p => {
            const spread = (1 - p.confidence) * 2;
            return {
                time: new Date(p.timestamp).getTime(),
                label: formatDateShort(p.timestamp),
                fullLabel: `${p.horizon} forecast`,
                mood: null as number | null,
                predicted: p.score,
                upper: Math.min(10, p.score + spread),
                lower: Math.max(1, p.score - spread),
                weather: '🔮',
                temperature: null,
                type: 'forecast' as const,
            };
        });

        // Bridge: connect last historical to first forecast
        if (historical.length > 0 && forecastPoints.length > 0) {
            const lastHistorical = historical[historical.length - 1];
            forecastPoints.unshift({
                ...lastHistorical,
                predicted: lastHistorical.mood,
                upper: lastHistorical.mood,
                lower: lastHistorical.mood,
                type: 'forecast',
            });
        }

        return [...historical, ...forecastPoints];
    }, [filteredData, predictions]);

    // ─── Day-of-week heatmap data ──────────────────────────────────────
    const dayHeatmap = useMemo(() => {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayScores: Record<number, number[]> = {};

        for (const dp of timeSeries) {
            const day = dp.dayOfWeek;
            if (!dayScores[day]) dayScores[day] = [];
            dayScores[day].push(dp.moodScore);
        }

        return dayNames.map((name, i) => {
            const scores = dayScores[i] || [];
            const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 5;
            return { name, avg, count: scores.length };
        });
    }, [timeSeries]);

    // ─── Custom tooltip ────────────────────────────────────────────────
    const CustomTooltip = ({ active, payload }: any) => {
        if (!active || !payload || payload.length === 0) return null;
        const data = payload[0]?.payload;
        if (!data) return null;

        return (
            <div className="bg-slate-900/95 border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-sm">
                <p className="text-xs text-slate-400 mb-1">{data.fullLabel}</p>
                {data.mood !== null && (
                    <p className="text-white font-semibold">
                        Mood: <span style={{ color: getMoodColor(data.mood) }}>{data.mood.toFixed(1)}/10</span>
                    </p>
                )}
                {data.predicted !== null && data.type === 'forecast' && (
                    <>
                        <p className="text-violet-400 font-semibold">
                            Predicted: {data.predicted.toFixed(1)}/10
                        </p>
                        {data.upper !== null && (
                            <p className="text-xs text-slate-500">
                                Range: {data.lower?.toFixed(1)} – {data.upper?.toFixed(1)}
                            </p>
                        )}
                    </>
                )}
                {data.temperature !== null && (
                    <p className="text-xs text-slate-500 mt-1">
                        {data.weather} {data.temperature?.toFixed(0)}°C
                    </p>
                )}
            </div>
        );
    };

    const rangeButtons: { label: string; value: TimeRange }[] = [
        { label: '7D', value: '7d' },
        { label: '14D', value: '14d' },
        { label: '30D', value: '30d' },
    ];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-800/60 backdrop-blur-xl shadow-xl overflow-hidden"
        >
            {/* Header */}
            <div className="p-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20">
                        <TrendingUp className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Mood Timeline</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {filteredData.length} data points · Predictions as dashed line
                        </p>
                    </div>
                </div>

                {/* Range selector */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                    {rangeButtons.map(btn => (
                        <button
                            key={btn.value}
                            onClick={() => setTimeRange(btn.value)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${timeRange === btn.value
                                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/20'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Chart */}
            <div className="px-4 pb-2">
                {chartData.length < 2 ? (
                    <div className="h-48 flex items-center justify-center">
                        <div className="text-center">
                            <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                            <p className="text-sm text-slate-400">Check in to start building your timeline</p>
                        </div>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={260}>
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
                            <defs>
                                <linearGradient id="moodGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.15} />
                                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>

                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="rgba(255,255,255,0.04)"
                                vertical={false}
                            />

                            <XAxis
                                dataKey="label"
                                tick={{ fill: '#64748b', fontSize: 10 }}
                                axisLine={{ stroke: 'rgba(255,255,255,0.05)' }}
                                tickLine={false}
                                interval="preserveStartEnd"
                            />

                            <YAxis
                                domain={[1, 10]}
                                tick={{ fill: '#64748b', fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                ticks={[2, 4, 6, 8, 10]}
                            />

                            <Tooltip content={<CustomTooltip />} />

                            {/* Confidence band */}
                            <Area
                                dataKey="upper"
                                stroke="none"
                                fill="url(#confidenceGradient)"
                                fillOpacity={1}
                                connectNulls={false}
                            />
                            <Area
                                dataKey="lower"
                                stroke="none"
                                fill="transparent"
                                fillOpacity={0}
                                connectNulls={false}
                            />

                            {/* Reference line at threshold */}
                            <ReferenceLine
                                y={4}
                                stroke="rgba(239, 68, 68, 0.3)"
                                strokeDasharray="3 3"
                                label={{ value: 'Alert', fill: '#ef4444', fontSize: 9, position: 'right' }}
                            />

                            {/* Historical mood line */}
                            <Line
                                dataKey="mood"
                                stroke="#8b5cf6"
                                strokeWidth={2.5}
                                dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }}
                                activeDot={{ fill: '#a78bfa', r: 5, strokeWidth: 2, stroke: '#fff' }}
                                connectNulls={false}
                            />

                            {/* Predicted mood line (dashed) */}
                            <Line
                                dataKey="predicted"
                                stroke="#c084fc"
                                strokeWidth={2}
                                strokeDasharray="6 4"
                                dot={{ fill: '#c084fc', r: 3, strokeWidth: 0 }}
                                activeDot={{ fill: '#c084fc', r: 5, strokeWidth: 2, stroke: '#fff' }}
                                connectNulls={false}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Day-of-Week Heatmap */}
            {timeSeries.length >= 7 && (
                <div className="px-6 pb-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs text-slate-500">Day-of-Week Mood Pattern</span>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                        {dayHeatmap.map(day => {
                            const intensity = Math.max(0.1, (day.avg - 1) / 9);
                            const bgColor = day.avg >= 7
                                ? `rgba(16, 185, 129, ${intensity * 0.5})`
                                : day.avg >= 5
                                    ? `rgba(139, 92, 246, ${intensity * 0.5})`
                                    : `rgba(239, 68, 68, ${intensity * 0.5})`;

                            return (
                                <div
                                    key={day.name}
                                    className="flex flex-col items-center gap-1 p-2 rounded-lg border border-white/5 transition-colors hover:border-white/10"
                                    style={{ backgroundColor: bgColor }}
                                >
                                    <span className="text-[10px] text-slate-400 font-medium">{day.name}</span>
                                    <span className="text-sm font-bold text-white">
                                        {day.count > 0 ? day.avg.toFixed(1) : '—'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </motion.div>
    );
}
