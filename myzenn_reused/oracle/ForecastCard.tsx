/**
 * ForecastCard.tsx — Weekly Mental Health Forecast Card
 * 
 * A beautiful, glassmorphic weather-app-inspired card showing
 * 3-day emotional forecast with mood-mapped gradients.
 */

import { motion } from 'framer-motion';
import {
    Sun, Cloud, CloudRain, Zap, Brain, Heart,
    TrendingUp, TrendingDown, Minus, Sparkles, ArrowRight,
    Shield
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { MoodPrediction, WeeklyForecast } from '@/hooks/useMoodForecaster';

// ─── Mood Visual Mapping ─────────────────────────────────────────────

function getMoodIcon(score: number) {
    if (score >= 8) return <Sun className="w-7 h-7" />;
    if (score >= 6) return <Cloud className="w-7 h-7" />;
    if (score >= 4) return <CloudRain className="w-7 h-7" />;
    return <Zap className="w-7 h-7" />;
}

function getMoodGradient(score: number): string {
    if (score >= 8) return 'from-emerald-500/20 to-cyan-500/20';
    if (score >= 6.5) return 'from-cyan-500/20 to-blue-500/20';
    if (score >= 5) return 'from-violet-500/20 to-purple-500/20';
    if (score >= 3.5) return 'from-amber-500/20 to-orange-500/20';
    return 'from-red-500/20 to-rose-500/20';
}

function getMoodBorderColor(score: number): string {
    if (score >= 8) return 'border-emerald-500/30';
    if (score >= 6.5) return 'border-cyan-500/30';
    if (score >= 5) return 'border-violet-500/30';
    if (score >= 3.5) return 'border-amber-500/30';
    return 'border-red-500/30';
}

function getMoodTextColor(score: number): string {
    if (score >= 8) return 'text-emerald-400';
    if (score >= 6.5) return 'text-cyan-400';
    if (score >= 5) return 'text-violet-400';
    if (score >= 3.5) return 'text-amber-400';
    return 'text-red-400';
}

function getMoodLabel(score: number): string {
    if (score >= 8) return 'Great';
    if (score >= 6.5) return 'Good';
    if (score >= 5) return 'Okay';
    if (score >= 3.5) return 'Low';
    if (score >= 2) return 'Difficult';
    return 'Critical';
}

function getTrendIcon(trend: string) {
    if (trend === 'improving') return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    if (trend === 'declining') return <TrendingDown className="w-5 h-5 text-red-400" />;
    return <Minus className="w-5 h-5 text-slate-400" />;
}

function getToolSuggestion(score: number): { tool: string; path: string; label: string } {
    if (score < 4) return { tool: 'MyPeace', path: '/mysanctuary/mypeace', label: 'Guided meditation' };
    if (score < 6) return { tool: 'MyBreath', path: '/mysanctuary/mybreath', label: 'Calm breathing' };
    return { tool: 'MyParticles', path: '/mysanctuary/zen-particles', label: 'Flow state' };
}

// ─── Component ───────────────────────────────────────────────────────

interface ForecastCardProps {
    weeklyForecast: WeeklyForecast;
    dataPointCount: number;
    minDataPoints: number;
}

export default function ForecastCard({ weeklyForecast, dataPointCount, minDataPoints }: ForecastCardProps) {
    const navigate = useNavigate();
    const { predictions, overallTrend, averagePredictedMood } = weeklyForecast;
    const hasEnoughData = dataPointCount >= minDataPoints;

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-800/60 backdrop-blur-xl shadow-2xl"
        >
            {/* Ambient glow */}
            <div className={`absolute inset-0 bg-gradient-to-br ${getMoodGradient(averagePredictedMood)} opacity-40 pointer-events-none`} />

            {/* Header */}
            <div className="relative p-6 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/20">
                        <Sparkles className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-white">Mental Health Forecast</h3>
                        <p className="text-xs text-slate-400 mt-0.5">72-hour emotional trajectory</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                    {getTrendIcon(overallTrend)}
                    <span className="text-sm text-slate-300 capitalize">{overallTrend}</span>
                </div>
            </div>

            {/* Predictions Grid */}
            <div className="relative px-6 pb-6">
                {!hasEnoughData ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="py-8 text-center"
                    >
                        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/20 flex items-center justify-center mb-4">
                            <Brain className="w-8 h-8 text-violet-400" />
                        </div>
                        <p className="text-white font-medium mb-1">Training your personal model</p>
                        <p className="text-slate-400 text-sm mb-4">
                            {dataPointCount} / {minDataPoints} mood check-ins collected
                        </p>
                        <div className="mx-auto w-48 h-2 rounded-full bg-slate-700/50 overflow-hidden">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (dataPointCount / minDataPoints) * 100)}%` }}
                                transition={{ duration: 1, ease: 'easeOut' }}
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-3">
                            Keep checking in daily to unlock personalized predictions
                        </p>
                    </motion.div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {predictions.map((pred, i) => {
                            const suggestion = getToolSuggestion(pred.score);
                            return (
                                <motion.div
                                    key={pred.horizon}
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.1 * i, duration: 0.5 }}
                                    className={`relative rounded-xl border ${getMoodBorderColor(pred.score)} bg-gradient-to-br ${getMoodGradient(pred.score)} p-4 hover:scale-[1.02] transition-transform cursor-default`}
                                >
                                    {/* Day label */}
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                                            +{pred.horizon}
                                        </span>
                                        <span className="text-[10px] text-slate-500">
                                            {Math.round(pred.confidence * 100)}% sure
                                        </span>
                                    </div>

                                    {/* Mood icon + score */}
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={getMoodTextColor(pred.score)}>
                                            {getMoodIcon(pred.score)}
                                        </div>
                                        <div>
                                            <p className={`text-2xl font-bold ${getMoodTextColor(pred.score)}`}>
                                                {pred.score.toFixed(1)}
                                            </p>
                                            <p className="text-xs text-slate-400">{getMoodLabel(pred.score)}</p>
                                        </div>
                                    </div>

                                    {/* Date */}
                                    <p className="text-[11px] text-slate-500 mb-3">
                                        {formatDate(pred.timestamp)} · {formatTime(pred.timestamp)}
                                    </p>

                                    {/* Action button */}
                                    <button
                                        onClick={() => navigate(suggestion.path)}
                                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Shield className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="text-xs text-slate-300">{suggestion.tool}</span>
                                        </div>
                                        <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white transition-colors" />
                                    </button>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer insight */}
            {hasEnoughData && weeklyForecast.insights.length > 0 && (
                <div className="px-6 pb-5">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                        <Heart className="w-4 h-4 text-pink-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-slate-300 leading-relaxed">
                            {weeklyForecast.insights[0].description}
                        </p>
                    </div>
                </div>
            )}

            {/* Privacy badge */}
            <div className="px-6 pb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-slate-500">All predictions run on-device · No data leaves your browser</span>
            </div>
        </motion.div>
    );
}
