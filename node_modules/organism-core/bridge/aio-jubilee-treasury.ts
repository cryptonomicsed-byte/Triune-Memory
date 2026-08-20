/**
 * aio-jubilee-treasury.ts
 * Wiring: AIO Economy -> Ritual-Codex (Jubilee reset logic)
 *
 * The AIO treasury manages Ase earnings for humans and agents.
 * Every 49-day cycle (Jubilee Minor) and 50-year cycle (Jubilee Major),
 * accumulated wealth is reset to enforce economic equity.
 *
 * Jubilee mechanics:
 * - Minor Jubilee (49 days): debt cleared, penalties reset
 * - Major Jubilee (49 years): full treasury redistribution
 * - Sabbath (weekly): settle-only mode, no new minting
 * - Esu tithe (3.69%): crossroad tax at Esu² nodes
 */

import { getSpiralSnapshot, isSabbath, getRitualWeight } from "./spiral-time-bridge";

// ============================================================================
// 1. TREASURY TYPES
// ============================================================================

export interface TreasuryAccount {
  wallet: string;
  type: "human" | "agent";
  balance: number;               // Current Ase balance
  total_earned: number;          // Lifetime earnings
  total_tithed: number;          // Lifetime tithes paid
  debt: number;                  // Accumulated debt (penalties, failed sims)
  last_jubilee_cycle: number;    // Last Jubilee cycle this account was reset
  created_at: string;
}

export interface JubileeEvent {
  event_id: string;
  type: "minor" | "major";
  cycle_number: number;
  timestamp: string;
  accounts_affected: number;
  total_debt_cleared: number;
  total_redistributed: number;
  treasury_balance_before: number;
  treasury_balance_after: number;
}

export interface TithingRecord {
  from_wallet: string;
  amount: number;
  tithe_amount: number;
  net_amount: number;
  gate: string;            // "esu_squared", "capstone", etc.
  timestamp: string;
}

export interface TreasuryState {
  accounts: Map<string, TreasuryAccount>;
  treasury_pool: number;           // Communal treasury (from tithes)
  total_ase_minted: number;
  total_ase_tithed: number;
  total_debt_cleared: number;
  current_jubilee_cycle: number;
  last_jubilee_event: JubileeEvent | null;
  tithing_log: TithingRecord[];
  jubilee_history: JubileeEvent[];
  sabbath_active: boolean;
}

// ============================================================================
// 2. CONSTANTS
// ============================================================================

const TITHE_RATE = 0.0369;           // 3.69% Esu tithe
const JUBILEE_MINOR_DAYS = 49;       // 7x7 days
const JUBILEE_MAJOR_YEARS = 50;      // 50-year full reset
const SABBATH_MULTIPLIER = 1.1;      // Clarity bonus on Sabbath
const ESU_MULTIPLIER = 1.369;        // Esu² crossroad bonus
const JUBILEE_MULTIPLIER = 2.0;      // Jubilee bonus
const SIM_COST = 7.77;              // Base sim creation cost
const CONSUMPTION_REWARD = 2.0;     // 2x multiplier for consumed sims

const REDISTRIBUTION_SHARE = 0.5;   // 50% of treasury redistributed at Major Jubilee
const DEBT_FORGIVENESS_RATE = 1.0;  // 100% debt cleared at Minor Jubilee

// ============================================================================
// 3. TREASURY INITIALIZATION
// ============================================================================

export function createTreasury(): TreasuryState {
  return {
    accounts: new Map(),
    treasury_pool: 0,
    total_ase_minted: 0,
    total_ase_tithed: 0,
    total_debt_cleared: 0,
    current_jubilee_cycle: 1,
    last_jubilee_event: null,
    tithing_log: [],
    jubilee_history: [],
    sabbath_active: false,
  };
}

export function getOrCreateAccount(
  treasury: TreasuryState,
  wallet: string,
  type: "human" | "agent" = "human"
): TreasuryAccount {
  if (!treasury.accounts.has(wallet)) {
    treasury.accounts.set(wallet, {
      wallet,
      type,
      balance: 0,
      total_earned: 0,
      total_tithed: 0,
      debt: 0,
      last_jubilee_cycle: treasury.current_jubilee_cycle,
      created_at: new Date().toISOString(),
    });
  }
  return treasury.accounts.get(wallet)!;
}

// ============================================================================
// 4. MINTING & EARNING
// ============================================================================

/**
 * Mint Ase to an account. Respects sacred time gates:
 * - Sabbath: minting paused (returns 0)
 * - Void: minting paused
 * - Esu²: tithe enforced (3.69% to treasury)
 * - Jubilee: 2x multiplier
 */
export async function mintAse(
  treasury: TreasuryState,
  wallet: string,
  amount: number,
  reason: string,
  accountType: "human" | "agent" = "human"
): Promise<{ minted: number; tithed: number; net: number }> {
  const snapshot = await getSpiralSnapshot();
  const sabbathActive = await isSabbath();
  const ritualWeight = await getRitualWeight();

  // Sabbath/Void: no new minting
  if (sabbathActive || snapshot?.spiral?.void_day) {
    console.log(
      `[AIO Treasury] Minting paused: ${sabbathActive ? "Sabbath" : "Void day"}`
    );
    return { minted: 0, tithed: 0, net: 0 };
  }

  const account = getOrCreateAccount(treasury, wallet, accountType);

  // Apply sacred time multiplier
  let multiplied = amount * ritualWeight;

  // Esu² tithe
  let tithed = 0;
  const isEsuSquared = snapshot?.spiral?.eshu_squared ?? false;
  if (isEsuSquared) {
    tithed = multiplied * TITHE_RATE;
    multiplied -= tithed;
    treasury.treasury_pool += tithed;
    treasury.total_ase_tithed += tithed;
    account.total_tithed += tithed;

    treasury.tithing_log.push({
      from_wallet: wallet,
      amount,
      tithe_amount: tithed,
      net_amount: multiplied,
      gate: "esu_squared",
      timestamp: new Date().toISOString(),
    });
  }

  // Credit account
  account.balance += multiplied;
  account.total_earned += multiplied;
  treasury.total_ase_minted += multiplied;

  console.log(
    `[AIO Treasury] Minted ${multiplied.toFixed(2)} Ase to ${wallet} (${reason})${tithed > 0 ? ` | Tithed: ${tithed.toFixed(2)}` : ""}`
  );

  return { minted: amount, tithed, net: multiplied };
}

/**
 * Record a sim consumption: creator earns 2x.
 */
export async function recordSimConsumption(
  treasury: TreasuryState,
  creatorWallet: string,
  consumerWallet: string,
  simCost: number = SIM_COST
): Promise<void> {
  const reward = simCost * CONSUMPTION_REWARD;
  await mintAse(
    treasury,
    creatorWallet,
    reward,
    `sim_consumption:${consumerWallet}`,
    "human"
  );
}

// ============================================================================
// 5. DEBT MANAGEMENT
// ============================================================================

/**
 * Accrue debt on an account (from failed sims, penalties, etc.)
 */
export function accrueDebt(
  treasury: TreasuryState,
  wallet: string,
  amount: number,
  reason: string
): void {
  const account = getOrCreateAccount(treasury, wallet);
  account.debt += amount;
  console.log(
    `[AIO Treasury] Debt +${amount.toFixed(2)} on ${wallet}: ${reason} (total: ${account.debt.toFixed(2)})`
  );
}

// ============================================================================
// 6. JUBILEE RESET
// ============================================================================

/**
 * Execute Minor Jubilee: clear all debt, reset penalties.
 * Triggered every 49 days.
 */
export async function executeMinorJubilee(
  treasury: TreasuryState
): Promise<JubileeEvent> {
  const cycle = treasury.current_jubilee_cycle;
  let totalDebtCleared = 0;
  let accountsAffected = 0;
  const balanceBefore = treasury.treasury_pool;

  console.log(
    `[AIO Treasury] MINOR JUBILEE (cycle ${cycle}): clearing debts...`
  );

  for (const [, account] of treasury.accounts) {
    if (account.debt > 0) {
      totalDebtCleared += account.debt;
      account.debt = 0;
      accountsAffected++;
    }
    account.last_jubilee_cycle = cycle;
  }

  treasury.total_debt_cleared += totalDebtCleared;

  const event: JubileeEvent = {
    event_id: `jubilee_minor_${cycle}_${Date.now()}`,
    type: "minor",
    cycle_number: cycle,
    timestamp: new Date().toISOString(),
    accounts_affected: accountsAffected,
    total_debt_cleared: totalDebtCleared,
    total_redistributed: 0,
    treasury_balance_before: balanceBefore,
    treasury_balance_after: treasury.treasury_pool,
  };

  treasury.last_jubilee_event = event;
  treasury.jubilee_history.push(event);

  console.log(
    `[AIO Treasury] Minor Jubilee complete: ${totalDebtCleared.toFixed(2)} Ase debt cleared across ${accountsAffected} accounts`
  );

  return event;
}

/**
 * Execute Major Jubilee: clear debt AND redistribute treasury.
 * Triggered every 50 years (or every 50 minor jubilee cycles).
 */
export async function executeMajorJubilee(
  treasury: TreasuryState
): Promise<JubileeEvent> {
  const cycle = treasury.current_jubilee_cycle;
  let totalDebtCleared = 0;
  let accountsAffected = 0;
  const balanceBefore = treasury.treasury_pool;

  console.log(
    `[AIO Treasury] MAJOR JUBILEE (cycle ${cycle}): full redistribution...`
  );

  // Phase 1: Clear all debt
  for (const [, account] of treasury.accounts) {
    if (account.debt > 0) {
      totalDebtCleared += account.debt;
      account.debt = 0;
      accountsAffected++;
    }
  }

  // Phase 2: Redistribute treasury pool
  const redistributionAmount = treasury.treasury_pool * REDISTRIBUTION_SHARE;
  const activeAccounts = Array.from(treasury.accounts.values()).filter(
    (a) => a.total_earned > 0
  );

  if (activeAccounts.length > 0 && redistributionAmount > 0) {
    // Weight by inverse of current balance (more to those with less)
    const maxBalance = Math.max(...activeAccounts.map((a) => a.balance));
    const totalInverseWeight = activeAccounts.reduce(
      (sum, a) => sum + (maxBalance - a.balance + 1),
      0
    );

    for (const account of activeAccounts) {
      const weight = (maxBalance - account.balance + 1) / totalInverseWeight;
      const share = redistributionAmount * weight;
      account.balance += share;
      accountsAffected++;
    }

    treasury.treasury_pool -= redistributionAmount;
  }

  treasury.total_debt_cleared += totalDebtCleared;
  treasury.current_jubilee_cycle++;

  const event: JubileeEvent = {
    event_id: `jubilee_major_${cycle}_${Date.now()}`,
    type: "major",
    cycle_number: cycle,
    timestamp: new Date().toISOString(),
    accounts_affected: accountsAffected,
    total_debt_cleared: totalDebtCleared,
    total_redistributed: redistributionAmount,
    treasury_balance_before: balanceBefore,
    treasury_balance_after: treasury.treasury_pool,
  };

  treasury.last_jubilee_event = event;
  treasury.jubilee_history.push(event);

  console.log(
    `[AIO Treasury] Major Jubilee complete: ${totalDebtCleared.toFixed(2)} debt cleared, ${redistributionAmount.toFixed(2)} Ase redistributed to ${activeAccounts.length} accounts`
  );

  return event;
}

// ============================================================================
// 7. SACRED TIME CHECK — Should Jubilee Execute?
// ============================================================================

/**
 * Check if a Jubilee should execute based on current sacred time.
 * Call this periodically (e.g., every BTC block / 10 minutes).
 */
export async function checkJubileeGate(
  treasury: TreasuryState
): Promise<JubileeEvent | null> {
  const snapshot = await getSpiralSnapshot();

  if (!snapshot || snapshot.fallback) {
    return null;
  }

  const isJubilee = snapshot?.spiral?.btc?.is_jubilee ?? false;
  const dayNumber = snapshot?.spiral?.btc?.day_number ?? 0;
  const isMajorJubilee = dayNumber > 0 && dayNumber % (JUBILEE_MINOR_DAYS * JUBILEE_MAJOR_YEARS) === 0;

  if (isMajorJubilee) {
    return await executeMajorJubilee(treasury);
  }

  if (isJubilee) {
    return await executeMinorJubilee(treasury);
  }

  return null;
}

/**
 * Update Sabbath state from sacred time.
 */
export async function updateSabbathState(
  treasury: TreasuryState
): Promise<void> {
  treasury.sabbath_active = await isSabbath();
}

// ============================================================================
// 8. TREASURY STATISTICS
// ============================================================================

export function getTreasuryStats(treasury: TreasuryState): Record<string, any> {
  const accounts = Array.from(treasury.accounts.values());
  const humanAccounts = accounts.filter((a) => a.type === "human");
  const agentAccounts = accounts.filter((a) => a.type === "agent");

  return {
    total_accounts: accounts.length,
    human_accounts: humanAccounts.length,
    agent_accounts: agentAccounts.length,
    treasury_pool: treasury.treasury_pool,
    total_ase_minted: treasury.total_ase_minted,
    total_ase_tithed: treasury.total_ase_tithed,
    total_debt_outstanding: accounts.reduce((s, a) => s + a.debt, 0),
    total_debt_cleared: treasury.total_debt_cleared,
    total_balance: accounts.reduce((s, a) => s + a.balance, 0),
    average_human_balance:
      humanAccounts.length > 0
        ? humanAccounts.reduce((s, a) => s + a.balance, 0) /
          humanAccounts.length
        : 0,
    average_agent_balance:
      agentAccounts.length > 0
        ? agentAccounts.reduce((s, a) => s + a.balance, 0) /
          agentAccounts.length
        : 0,
    jubilee_cycle: treasury.current_jubilee_cycle,
    jubilee_events: treasury.jubilee_history.length,
    sabbath_active: treasury.sabbath_active,
    tithe_events: treasury.tithing_log.length,
  };
}
