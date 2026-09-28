/**
 * MyCompass — Lin-Thompson Sampling Contextual Bandit
 * 
 * Implements a Bayesian linear contextual bandit using Thompson Sampling.
 * For each arm (therapy tool), we maintain a linear model:
 *   E[R | x, θ] = θᵀ · x
 * 
 * Posterior over θ is a multivariate Gaussian (conjugate prior):
 *   p(θ) = N(μ, σ²·Λ⁻¹)
 * 
 * At each step:
 * 1. Sample θ̃ from posterior for each arm
 * 2. Select arm with highest θ̃ᵀ · x
 * 3. Observe reward r
 * 4. Update posterior: Λ += xxᵀ, b += r·x → μ = Λ⁻¹b
 */

export interface ArmState {
    /** Precision matrix (d×d). Initially identity * λ for regularisation. */
    A: number[][];
    /** Reward-weighted context sum (d-vector). */
    b: number[];
    /** Cached mean θ = A⁻¹b (d-vector). Updated lazily after each step. */
    theta: number[];
    /** Number of times this arm has been pulled. */
    pulls: number;
    /** Running sum of observed rewards. */
    totalReward: number;
}

export interface BanditConfig {
    /** Number of context features. */
    contextDim: number;
    /** L2 regularisation coefficient. */
    lambda?: number;
    /** Thompson Sampling noise variance (exploration). */
    sigma?: number;
    /** Arm IDs (tool ids). */
    arms: string[];
}

export interface BanditState {
    arms: Record<string, ArmState>;
    config: BanditConfig;
    totalRounds: number;
}

// ─── Matrix helpers (pure JS, no deps) ─────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
    const n = A.length, m = B[0].length, k = B.length;
    const C = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            for (let p = 0; p < k; p++)
                C[i][j] += A[i][p] * B[p][j];
    return C;
}

function matVec(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

function dotProduct(a: number[], b: number[]): number {
    return a.reduce((s, ai, i) => s + ai * b[i], 0);
}

/**
 * Gaussian elimination-based matrix inverse.
 * Sufficient for d ≤ ~15 (our context dim).
 */
function invertMatrix(A: number[][]): number[][] {
    const n = A.length;
    const aug = A.map((row, i) => {
        const identity = new Array(n).fill(0);
        identity[i] = 1;
        return [...row, ...identity];
    });

    for (let col = 0; col < n; col++) {
        // Find pivot
        let maxRow = col;
        for (let r = col + 1; r < n; r++)
            if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
        [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

        const pivot = aug[col][col];
        if (Math.abs(pivot) < 1e-12) continue;
        for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = aug[r][col];
            for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
        }
    }
    return aug.map(row => row.slice(n));
}

/** Sample from multivariate normal N(μ, σ² A⁻¹). */
function sampleTheta(mu: number[], A: number[][], sigma: number): number[] {
    const n = mu.length;
    const Ainv = invertMatrix(A);
    // Cholesky-like: decompose A⁻¹ = LLᵀ (simplified: use diagonal scaled sampling)
    // For a lightweight approximation, we sample each dimension independently
    // using the diagonal variance from A⁻¹ * sigma²
    return mu.map((m, i) => {
        const variance = Math.abs(Ainv[i][i]) * sigma * sigma;
        const std = Math.sqrt(variance);
        // Box-Muller transform for standard normal
        const u1 = Math.max(1e-12, Math.random());
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return m + std * z;
    });
}

// ─── Bandit API ─────────────────────────────────────────────────────────────

/** Initialise a fresh bandit state for the given config. */
export function initBandit(config: BanditConfig): BanditState {
    const d = config.contextDim;
    const lambda = config.lambda ?? 1.0;

    const arms: Record<string, ArmState> = {};
    for (const arm of config.arms) {
        // Initialise A = λI (regularised identity)
        const A: number[][] = Array.from({ length: d }, (_, i) =>
            Array.from({ length: d }, (_, j) => (i === j ? lambda : 0))
        );
        arms[arm] = {
            A,
            b: new Array(d).fill(0),
            theta: new Array(d).fill(0),
            pulls: 0,
            totalReward: 0,
        };
    }

    return { arms, config, totalRounds: 0 };
}

/** Select the best arm given the current context. Returns arm id + confidence. */
export function recommend(
    state: BanditState,
    context: number[]
): { armId: string; confidence: number; scores: Record<string, number> } {
    const { arms, config } = state;
    const sigma = config.sigma ?? 0.5;

    const scores: Record<string, number> = {};
    let bestArm = config.arms[0];
    let bestScore = -Infinity;

    for (const armId of config.arms) {
        const arm = arms[armId];
        // Thompson Sampling: sample from posterior
        const thetaSample = arm.pulls === 0
            ? new Array(config.contextDim).fill(0).map(() => (Math.random() - 0.5) * 0.1) // cold start: random exploration
            : sampleTheta(arm.theta, arm.A, sigma);

        const score = dotProduct(thetaSample, context);
        scores[armId] = score;
        if (score > bestScore) {
            bestScore = score;
            bestArm = armId;
        }
    }

    // Softmax confidence based on score gap
    const scoreValues = Object.values(scores);
    const maxScore = Math.max(...scoreValues);
    const expScores = scoreValues.map(s => Math.exp(s - maxScore));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const armIndex = config.arms.indexOf(bestArm);
    const confidence = Math.round((expScores[armIndex] / sumExp) * 100);

    return { armId: bestArm, confidence, scores };
}

/** Update the model after observing a reward for a specific arm. */
export function update(
    state: BanditState,
    armId: string,
    context: number[],
    reward: number
): BanditState {
    const arm = { ...state.arms[armId] };
    const d = context.length;

    // A += xxᵀ  (rank-1 outer product update)
    const newA = arm.A.map((row, i) =>
        row.map((val, j) => val + context[i] * context[j])
    );

    // b += r * x
    const newB = arm.b.map((val, i) => val + reward * context[i]);

    // θ = A⁻¹b
    const Ainv = invertMatrix(newA);
    const newTheta = matVec(Ainv, newB);

    const updatedArm: ArmState = {
        A: newA,
        b: newB,
        theta: newTheta,
        pulls: arm.pulls + 1,
        totalReward: arm.totalReward + reward,
    };

    return {
        ...state,
        arms: { ...state.arms, [armId]: updatedArm },
        totalRounds: state.totalRounds + 1,
    };
}

/** Serialize bandit state to JSON (for localStorage persistence). */
export function serializeBandit(state: BanditState): string {
    return JSON.stringify(state);
}

/** Restore bandit state from JSON. */
export function deserializeBandit(json: string): BanditState {
    return JSON.parse(json) as BanditState;
}

/**
 * Get arm statistics for the explainability layer.
 * Returns average reward and feature contributions.
 */
export function getArmStats(state: BanditState, armId: string) {
    const arm = state.arms[armId];
    if (!arm) return null;
    return {
        pulls: arm.pulls,
        avgReward: arm.pulls > 0 ? arm.totalReward / arm.pulls : 0,
        theta: arm.theta,
    };
}
