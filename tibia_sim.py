import math
from collections import defaultdict

TURN_DURATION = 2.25

def build_present_table(box_time, spawn_curve, max_steps=50):
    tbl = []
    for i in range(max_steps + 1):
        elapsed = i * TURN_DURATION
        if elapsed <= 0:
            tbl.append(0.0)
        elif elapsed >= box_time:
            tbl.append(1.0)
        else:
            tbl.append(1.0 - math.pow(1.0 - elapsed / box_time, spawn_curve))
    return tbl

def lcg_rng(seed):
    s = seed & 0xFFFFFFFF or 1
    while True:
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        yield s / 4294967296

def simulate(box_size, exit_threshold, box_time, spawn_curve, n_sessions=500, max_turns=200, seed=42):
    tbl = build_present_table(box_time, spawn_curve)
    alive_counts = defaultdict(int)
    total_turns = 0

    for sess in range(n_sessions):
        rng = lcg_rng(seed + sess)
        rng_vals = [next(rng) for _ in range(max_turns * 30)]
        ri = 0

        alive = [14105] * box_size  # start with full box
        buffer = []
        spawn_step = 0

        for turn in range(max_turns):
            # Spawn from buffer
            if buffer:
                spawn_step += 1
                p_now = tbl[spawn_step] if spawn_step < len(tbl) else 1.0
                p_prev = tbl[spawn_step - 1] if spawn_step - 1 >= 0 else 0.0
                p_cond = (p_now - p_prev) / (1.0 - p_prev) if p_prev < 1.0 else 1.0
                new_buffer = []
                for mob in buffer:
                    if rng_vals[ri] < p_cond:
                        alive.append(mob)
                    else:
                        new_buffer.append(mob)
                    ri += 1
                buffer = new_buffer

            # Record alive count
            n_alive = len(alive)
            alive_counts[n_alive] += 1
            total_turns += 1

            # Kill model: each turn, each mob has p_kill chance of dying
            # Kill rate ~1 mob/turn on average (rough estimate)
            if alive and rng_vals[ri] < min(0.9, 1.0 / max(1, len(alive))):
                alive.pop(0)
            ri += 1

            # Check for arrasto trigger
            if not buffer and len(alive) <= exit_threshold:
                buffer = [14105] * box_size
                spawn_step = 0

    return alive_counts, total_turns

def percentile(flat_sorted, p):
    idx = int(p * len(flat_sorted))
    idx = min(idx, len(flat_sorted) - 1)
    return flat_sorted[idx]

# ---- Real log data ----
real_raw = {
    1:1, 3:2, 4:2, 5:1, 6:3, 7:3, 8:5, 9:6, 10:10, 11:6,
    12:11, 13:11, 14:7, 15:10, 16:10, 17:8, 18:5, 19:6, 20:8,
    21:6, 22:8, 23:5, 24:2, 25:3, 26:1
}
real_total = 143

# Effective mobs = raw_hits / 2 (paladin = 2 attacks/turn)
# We compare alive_mobs (sim) vs raw_hits/2 (real)
real_eff_vals = []
for raw_hits, cnt in real_raw.items():
    for _ in range(cnt):
        real_eff_vals.append(raw_hits / 2.0)
real_eff_vals.sort()

real_mean = sum(real_eff_vals) / len(real_eff_vals)
real_p10  = percentile(real_eff_vals, 0.10)
real_p90  = percentile(real_eff_vals, 0.90)

# Build real histogram (bucket by int effective mobs, 0..13)
real_hist = defaultdict(int)
for v in real_eff_vals:
    bucket = int(v)  # floor
    real_hist[bucket] += 1

print("=" * 72)
print("TIBIA HUNT SIMULATION — SCENARIO COMPARISON")
print("=" * 72)
print(f"\nReal log: mean={real_mean:.2f}, p10={real_p10:.1f}, p90={real_p90:.1f}  (total={real_total} turns)")
print()

# Scenarios
scenarios = [
    ("A: SPAWN=2.4, boxTime=6s",  2.4,  6),
    ("B: SPAWN=1.0, boxTime=6s",  1.0,  6),
    ("C: SPAWN=1.0, boxTime=28s", 1.0, 28),
]

all_results = []
for label, sc, bt in scenarios:
    counts, total = simulate(12, 5, bt, sc)
    flat = []
    for k, cnt in counts.items():
        flat.extend([k] * cnt)
    flat.sort()
    mean = sum(flat) / len(flat)
    p10  = percentile(flat, 0.10)
    p90  = percentile(flat, 0.90)
    all_results.append((label, counts, total, mean, p10, p90))

# ---- Comparison table ----
print(f"{'Mobs':>5} | {'Real log':>10} | {'Scen A':>10} | {'Scen B':>10} | {'Scen C':>10}")
print("-" * 56)
for i in range(0, 14):
    real_pct = real_hist.get(i, 0) / real_total * 100
    row = f"  {i:2d}   | {real_pct:8.1f}% |"
    for label, counts, total, mean, p10, p90 in all_results:
        pct = counts.get(i, 0) / total * 100
        row += f" {pct:8.1f}% |"
    print(row)

print("-" * 56)
print(f"{'mean':>5} | {real_mean:8.2f}  |", end="")
for label, counts, total, mean, p10, p90 in all_results:
    print(f" {mean:8.2f}  |", end="")
print()
print(f"{'p10':>5} | {real_p10:8.1f}  |", end="")
for label, counts, total, mean, p10, p90 in all_results:
    print(f" {p10:8.1f}  |", end="")
print()
print(f"{'p90':>5} | {real_p90:8.1f}  |", end="")
for label, counts, total, mean, p10, p90 in all_results:
    print(f" {p90:8.1f}  |", end="")
print()

print()
print("=" * 72)
print("SCENARIO SUMMARIES")
print("=" * 72)
for label, counts, total, mean, p10, p90 in all_results:
    print(f"\n{label}")
    print(f"  Sessions=500, Turns/session=200, Total turns={total}")
    print(f"  mean={mean:.2f}  p10={p10}  p90={p90}")
    print("  Mobs alive | % of turns")
    for i in range(0, 14):
        pct = counts.get(i, 0) / total * 100
        bar = '#' * int(pct / 0.5)
        print(f"    {i:2d}       | {pct:5.1f}%  {bar}")
