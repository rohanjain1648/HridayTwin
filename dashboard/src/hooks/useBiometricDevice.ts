/**
 * useBiometricDevice — Web Bluetooth + DeviceMotion Hook
 * 
 * Connects to BLE Heart Rate monitors (standard 0x180D service)
 * or falls back to device accelerometer for restlessness tracking.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────
export interface BiometricData {
    heartRate: number | null;
    hrv: number | null;          // RMSSD in ms
    restlessness: number;        // 0–100
    skinTemp: number | null;     // reserved
    source: 'bluetooth' | 'motion' | 'none';
    timestamp: number;
}

export interface UseBiometricDevice {
    data: BiometricData;
    history: BiometricData[];
    isConnected: boolean;
    isConnecting: boolean;
    error: string | null;
    supportsBluetooth: boolean;
    supportsMotion: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
    startMotionFallback: () => void;
    clearHistory: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────
const HR_SERVICE_UUID = 0x180D;
const HR_CHARACTERISTIC_UUID = 0x2A37;
const HISTORY_MAX = 600;          // 10 min at 1 Hz
const MOTION_SAMPLE_INTERVAL = 100; // ms
const MOTION_WINDOW = 30;         // rolling window for restlessness
const RESTLESSNESS_SCALE = 15;    // calibration multiplier

const EMPTY_DATA: BiometricData = {
    heartRate: null,
    hrv: null,
    restlessness: 0,
    skinTemp: null,
    source: 'none',
    timestamp: Date.now(),
};

// ─── HRV Calculation ─────────────────────────────────────────────────
function computeRMSSD(rrIntervals: number[]): number | null {
    if (rrIntervals.length < 2) return null;
    const diffs: number[] = [];
    for (let i = 1; i < rrIntervals.length; i++) {
        diffs.push(rrIntervals[i] - rrIntervals[i - 1]);
    }
    const meanSquare = diffs.reduce((s, d) => s + d * d, 0) / diffs.length;
    return Math.round(Math.sqrt(meanSquare));
}

// ─── Restlessness from accelerometer ─────────────────────────────────
function computeRestlessness(magnitudes: number[]): number {
    if (magnitudes.length < 2) return 0;
    const mean = magnitudes.reduce((s, v) => s + v, 0) / magnitudes.length;
    const variance = magnitudes.reduce((s, v) => s + (v - mean) ** 2, 0) / magnitudes.length;
    const std = Math.sqrt(variance);
    return Math.min(100, Math.round(std * RESTLESSNESS_SCALE));
}

// ─── Hook ────────────────────────────────────────────────────────────
export function useBiometricDevice(): UseBiometricDevice {
    const [data, setData] = useState<BiometricData>(EMPTY_DATA);
    const [history, setHistory] = useState<BiometricData[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Refs for BLE cleanup
    const bleDeviceRef = useRef<BluetoothDevice | null>(null);
    const bleCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
    const rrBufferRef = useRef<number[]>([]);

    // Refs for motion fallback
    const motionActiveRef = useRef(false);
    const motionMagnitudesRef = useRef<number[]>([]);
    const motionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const supportsBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
    const supportsMotion = typeof window !== 'undefined' && !!window.DeviceMotionEvent;

    // ─── Push to history ─────────────────────────────────────────────
    const pushHistory = useCallback((entry: BiometricData) => {
        setHistory(prev => {
            const next = [...prev, entry];
            return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
        });
    }, []);

    // ─── BLE: Parse HR Measurement ───────────────────────────────────
    const handleHRNotification = useCallback((event: Event) => {
        const char = event.target as BluetoothRemoteGATTCharacteristic;
        const value = char.value;
        if (!value) return;

        const flags = value.getUint8(0);
        const is16Bit = flags & 0x01;
        const hasRR = flags & 0x10;

        let hr: number;
        let offset: number;

        if (is16Bit) {
            hr = value.getUint16(1, true);
            offset = 3;
        } else {
            hr = value.getUint8(1);
            offset = 2;
        }

        // Energy expended field (skip if present)
        if (flags & 0x08) {
            offset += 2;
        }

        // RR-intervals (in 1/1024 sec units)
        if (hasRR) {
            while (offset + 1 < value.byteLength) {
                const rrRaw = value.getUint16(offset, true);
                const rrMs = Math.round((rrRaw / 1024) * 1000);
                rrBufferRef.current.push(rrMs);
                // Keep last 20 RR-intervals for HRV
                if (rrBufferRef.current.length > 20) {
                    rrBufferRef.current = rrBufferRef.current.slice(-20);
                }
                offset += 2;
            }
        }

        const hrv = computeRMSSD(rrBufferRef.current);

        const entry: BiometricData = {
            heartRate: hr,
            hrv,
            restlessness: data.restlessness, // keep current motion value if running
            skinTemp: null,
            source: 'bluetooth',
            timestamp: Date.now(),
        };

        setData(entry);
        pushHistory(entry);
    }, [data.restlessness, pushHistory]);

    // ─── BLE: Connect ────────────────────────────────────────────────
    const connect = useCallback(async () => {
        if (!supportsBluetooth) {
            setError('Web Bluetooth is not supported in this browser. Try Chrome or Edge.');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [HR_SERVICE_UUID] }],
                optionalServices: [HR_SERVICE_UUID],
            });

            bleDeviceRef.current = device;

            device.addEventListener('gattserverdisconnected', () => {
                setIsConnected(false);
                setData(prev => ({ ...prev, source: 'none' }));
            });

            const server = await device.gatt!.connect();
            const service = await server.getPrimaryService(HR_SERVICE_UUID);
            const characteristic = await service.getCharacteristic(HR_CHARACTERISTIC_UUID);

            bleCharRef.current = characteristic;
            rrBufferRef.current = [];

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', handleHRNotification);

            setIsConnected(true);
            setIsConnecting(false);
        } catch (err: any) {
            const msg = err?.message || 'Failed to connect to Bluetooth device';
            if (msg.includes('cancelled') || msg.includes('canceled')) {
                setError('Pairing was cancelled. You can try again or use motion sensors instead.');
            } else {
                setError(msg);
            }
            setIsConnecting(false);
        }
    }, [supportsBluetooth, handleHRNotification]);

    // ─── BLE: Disconnect ─────────────────────────────────────────────
    const disconnectBLE = useCallback(() => {
        if (bleCharRef.current) {
            try {
                bleCharRef.current.removeEventListener('characteristicvaluechanged', handleHRNotification);
                bleCharRef.current.stopNotifications().catch(() => { });
            } catch { }
            bleCharRef.current = null;
        }
        if (bleDeviceRef.current?.gatt?.connected) {
            bleDeviceRef.current.gatt.disconnect();
        }
        bleDeviceRef.current = null;
        rrBufferRef.current = [];
    }, [handleHRNotification]);

    // ─── Motion: Start ───────────────────────────────────────────────
    const startMotionFallback = useCallback(() => {
        if (motionActiveRef.current) return;
        motionActiveRef.current = true;
        motionMagnitudesRef.current = [];
        setError(null);

        const handleMotion = (e: DeviceMotionEvent) => {
            const acc = e.accelerationIncludingGravity;
            if (!acc || acc.x == null || acc.y == null || acc.z == null) return;
            const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
            motionMagnitudesRef.current.push(magnitude);
            if (motionMagnitudesRef.current.length > MOTION_WINDOW) {
                motionMagnitudesRef.current = motionMagnitudesRef.current.slice(-MOTION_WINDOW);
            }
        };

        window.addEventListener('devicemotion', handleMotion);

        // Sample restlessness at interval
        motionIntervalRef.current = setInterval(() => {
            const restlessness = computeRestlessness(motionMagnitudesRef.current);
            const entry: BiometricData = {
                heartRate: null,
                hrv: null,
                restlessness,
                skinTemp: null,
                source: 'motion',
                timestamp: Date.now(),
            };
            setData(entry);
            pushHistory(entry);
        }, MOTION_SAMPLE_INTERVAL * 10); // ~1 Hz push

        setIsConnected(true);
        setData(prev => ({ ...prev, source: 'motion' }));

        // Store cleanup
        (window as any).__myPulseMotionHandler = handleMotion;
    }, [pushHistory]);

    // ─── Motion: Stop ────────────────────────────────────────────────
    const stopMotion = useCallback(() => {
        motionActiveRef.current = false;
        if (motionIntervalRef.current) {
            clearInterval(motionIntervalRef.current);
            motionIntervalRef.current = null;
        }
        const handler = (window as any).__myPulseMotionHandler;
        if (handler) {
            window.removeEventListener('devicemotion', handler);
            delete (window as any).__myPulseMotionHandler;
        }
        motionMagnitudesRef.current = [];
    }, []);

    // ─── Disconnect all ──────────────────────────────────────────────
    const disconnect = useCallback(() => {
        disconnectBLE();
        stopMotion();
        setIsConnected(false);
        setData(EMPTY_DATA);
    }, [disconnectBLE, stopMotion]);

    // ─── Clear history ───────────────────────────────────────────────
    const clearHistory = useCallback(() => {
        setHistory([]);
    }, []);

    // ─── Cleanup on unmount ──────────────────────────────────────────
    useEffect(() => {
        return () => {
            disconnectBLE();
            stopMotion();
        };
    }, [disconnectBLE, stopMotion]);

    return {
        data,
        history,
        isConnected,
        isConnecting,
        error,
        supportsBluetooth,
        supportsMotion,
        connect,
        disconnect,
        startMotionFallback,
        clearHistory,
    };
}
